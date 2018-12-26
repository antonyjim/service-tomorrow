/**
 * routes.middleware.authentication.ts
 * 
 * Handle validation of endpoints and token issuance
*/

// Node Modules


// NPM Modules
import { Request, Response, NextFunction } from 'express'
import { sign, verify } from 'jsonwebtoken'

// Local Modules
import { validateEndpoint } from './../../lib/navigation/navigation'
import { StatusMessage } from './../../types/server'
import { UserTypes } from '../../types/users';
import { jwtSecret } from '../../lib/connection';

// Constants and global variables

export function tokenValidation() {
    return function tokenValidation(req: Request, res: Response, next: NextFunction) {
        let anonToken: UserTypes.AuthToken = {
            userIsAuthenticated: false,
            userId: null,
            userRole: null
        }
        let tokenCookie = req.cookies.token || req.query.token
        if (tokenCookie) {
            tokenCookie = tokenCookie.split('Bearer ')[1] || tokenCookie
        }
        req.auth = {}

        function handleOnAuthError(error: Error) {
            req.auth = {
                isAuthenticated: false,
                isAuthorized: false,
                userId: null
            }
            console.error(error)
            sign(anonToken, jwtSecret, {expiresIn: '1h'}, function(err: Error, token: string) {
                if (err) {handleOnAuthError(err)}
                req.auth = {
                    isAuthenticated: false,
                    isAuthorized: false,
                    userId: null
                }
                res.cookie('token', token)
                next()
            })
        }
        if (!tokenCookie) {
            sign(anonToken, jwtSecret, {expiresIn: '1h'}, function(err: Error, token: string) {
                if (err) {handleOnAuthError(err)}
                req.auth = {
                    isAuthenticated: false,
                    isAuthorized: false,
                    userId: null
                }
                res.cookie('token', token)
                next()
            })
        } else {
            verify(tokenCookie, jwtSecret, function(err: Error, decoded: UserTypes.AuthToken) {
                if (err) {handleOnAuthError(err)}
                if (decoded) {
                    let authToken: UserTypes.AuthToken = {
                        userIsAuthenticated: true,
                        userId: decoded.userId,
                        userRole: decoded.userRole
                    }
                    sign(authToken, jwtSecret, {expiresIn: '1h'}, function(err: Error, token: string) {
                        if (err) {handleOnAuthError(err)}
                        req.auth = {
                            isAuthenticated: true,
                            isAuthorized: false,
                            userId: decoded.userId,
                            userRole: decoded.userRole
                        }
                        console.log(JSON.stringify(decoded))
                        res.cookie('token', token)
                        next()
                    })
                } else {
                    handleOnAuthError(new Error('Decoded value not found'))
                }
            })
        }
    }
}

export function endpointAuthentication() {
    return function endpointAuthentication(req: Request, res: Response, next: NextFunction) {
        if (!req.auth || !req.auth.isAuthenticated || !req.auth.userId) {
            req.auth.isAuthorized = false
            res.status(401).json({
                error: true,
                message: 'User unauthenticated'
            })
        } else {
            validateEndpoint(req.method, req.originalUrl, req.auth.userRole)
            .then((onUserAuthorized: StatusMessage) => {
                req.auth.isAuthorized = onUserAuthorized.details.authorized
                next()
            }, (onUserUnAuthorized: StatusMessage) => {
                req.auth.isAuthorized = onUserUnAuthorized.details.authorized
                res.status(401).json({
                    error: true,
                    message: 'User unauthorized with current privileges'
                })
            })
            .catch((error: StatusMessage) => {
                console.error(error)
                req.auth.isAuthorized = false
                res.status(401).json({
                    error: true,
                    message: 'User authorization failed'
                })
            })
        }
    }
}