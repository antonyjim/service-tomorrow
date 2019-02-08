/**
 * users.maintenance.ts
 * Provide utilities for creating and modifying user accounts and nonsigs
*/

// Node Modules


// NPM Modules
import * as uuid from 'uuid'
import { hashSync } from 'bcrypt'
import { sign, verify } from 'jsonwebtoken'

// Local Modules
import { UserTypes } from '../../types/users'
import { Validation } from '../validation'
import { StatusMessage } from '../../types/server';
import { getPool, jwtSecret } from '../connection';
import { sendConfirmation, sendFailedPasswordReset, sendPasswordReset } from '../email/emails';
import { NonsigTypes } from '../../types/nonsig';


// Constants and global variables
const pool = getPool()
const saltRounds = 10

export class Nonsig {
    nonsig: NonsigTypes.nsInfo

    /**
     * @param ns Nonsig information
     */
    constructor(ns) {
        this.nonsig = ns
        this.normalizeNonsig()
    }

    private normalizeNonsig() {
        let nonsig = this.nonsig.nsNonsig
        if (nonsig &&nonsig.length < 9) {
            while (nonsig.length < 9) nonsig = '0' + nonsig
            this.nonsig.nsNonsig = nonsig
            return 0
        } else if (nonsig && nonsig.length > 9) {
            this.nonsig.nsNonsig = nonsig.slice(0, 9)
            return 0
        } else if (nonsig && nonsig.length === 9) {
            return 0  
        } else {
            throw new TypeError('No customer number provided')
        }
    }

    private checkForExistingNonsig(nsNonsig) {
        return new Promise((resolve, reject) => {
            let sql = `
                SELECT *
                FROM sys_customer
                WHERE nsNonsig = ${pool.escape(nsNonsig)}
            `
            pool.query(sql, (err: Error, results) => {
                if (err) {
                    throw {
                        error: true,
                        message: err
                    }
                } else {
                    if (results.length > 0) {
                        reject({
                            error: true,
                            message: 'Nonsig already exists',
                            details: results
                        })
                    } else {
                        resolve({
                            error: false,
                            message: 'Nonsig does not exist'
                        })
                    }
                }
            })
        })
    }

    public create() {
        return new Promise((resolve, reject) => {
            let validator = new Validation(this.nonsig)
            let invalidFields = validator.defaults(
                [
                    'nsTradeStyle',
                    'nsNonsig',
                    'nsAddr1',
                    'nsCity',
                    'nsPostalCode',
                    'nsCountry',
                    'nsType'
                ]
            )
            if (invalidFields) {
                reject(invalidFields)
            } else {
                this.checkForExistingNonsig(this.nonsig.nsNonsig)
                .then((onSuccess: StatusMessage) => {
                    let nsToAdd = validator.defaults({
                        nsId: uuid.v4(),
                        nsIsActive: true,
                        nsIsActiveTHQ: true,
                        nsAddr2: null,
                        nsBrandKey: null
                    })
                    let insertionSql = `
                        INSERT INTO
                            sys_customer (
                                nsId,
                                nsTradeStyle,
                                nsNonsig,
                                nsAddr1,
                                nsAddr2,
                                nsCity,
                                nsState,
                                nsPostalCode,
                                nsCountry,
                                nsBrandKey,
                                nsIsActive,
                                nsIsActiveTHQ,
                                nsType
                            )
                        VALUES (
                            ${pool.escape([
                                nsToAdd.nsId,
                                nsToAdd.nsTradeStyle,
                                nsToAdd.nsNonsig,
                                nsToAdd.nsAddr1,
                                nsToAdd.nsAddr2,
                                nsToAdd.nsCity,
                                nsToAdd.nsState,
                                nsToAdd.nsPostalCode,
                                nsToAdd.nsCountry,
                                nsToAdd.nsBrandKey,
                                nsToAdd.nsIsActive,
                                nsToAdd.nsIsActiveTHQ,
                                nsToAdd.nsType
                            ])}
                        )
                    `
                    pool.query(insertionSql, (err: Error, results) => {
                        if (err) {
                            throw {
                                error: true,
                                message: err
                            }
                         } else {
                            resolve({
                                error: false,
                                message: 'Added nonsig',
                                details: nsToAdd
                            })
                         }
                    })
                }, (onFailure: StatusMessage) => {
                    reject(onFailure)
                })
                .catch((err: StatusMessage) => {
                    reject(err)
                })
            }
        })
    }

    public existsAndIsActive(): Promise<{error: boolean, isActiveTHQ: boolean, isActive: boolean}> {
        return new Promise((resolve, reject) => {
            let sql = `
                SELECT nsNonsig, nsIsActive, nsIsActiveTHQ
                FROM sys_customer
                WHERE nsNonsig = ${pool.escape(this.nonsig.nsNonsig)}
            `
            pool.query(sql, (err: Error, results: Array<NonsigTypes.nsInfo>) => {
                if (err) {
                    throw err
                } else {
                    if (results.length === 1) {
                        const nonsig = results[0]
                        resolve({
                            error: false,
                            isActiveTHQ: nonsig.nsIsActiveTHQ,
                            isActive: nonsig.nsIsActive
                        })
                    } else {
                        reject({
                            error: true,
                            message: 'No nonsig found'
                        })
                    }
                }
            })
        })
    }
} // Nonsig

export class User {
    userOpt: UserTypes.All

    /**
     * Create, edit, destroy users
     */
    constructor(options: UserTypes.All) {
        this.userOpt = options
    }

    private clearPasswordResets() {
        if(!this.userOpt.sys_id) {
            return 1
        } else {
            let sql = `
                UPDATE sys_user
                SET userConfirmation = NULL
                WHERE sys_id = ${pool.escape(this.userOpt.sys_id)}
            `
            pool.query(sql, (err: Error, results) => {
                return 1
            })
        }
    }

    /*
    private newAccount(accountOpts: UserTypes.All): Promise<StatusMessage> {
        return new Promise((resolve, reject) => {
            pool.query(
                `SELECT * 
                FROM sys_user
                WHERE username = ${pool.escape(accountOpts.username)}
                    OR sys_id = ${pool.escape(accountOpts.sys_id)}
                    OR email = ${pool.escape(accountOpts.email)}`,
                function(err: Error, results: Array<UserTypes.LoginInfo>) {
                    if (err) {throw err}
                    if (results.length > 0) {
                        let reason: StatusMessage = {
                            error: true,
                            message: 'Username or ID or Email already exist'
                        }
                        reject(reason)
                    } else {
                        new Nonsig({nsNonsig: accountOpts.userDefaultNonsig}).existsAndIsActive()
                        .then((nonsigExists) => {
                            if(nonsigExists.isActive && nonsigExists.isActiveTHQ) {
                                pool.query(
                                    `CALL newUser (
                                        ${pool.escape([
                                            accountOpts.sys_id,
                                            accountOpts.username.toLowerCase(),
                                            null,
                                            accountOpts.email.toLowerCase(),
                                            accountOpts.userDefaultNonsig,
                                            (accountOpts.userIsLocked === true ? 1 : 0),
                                            0,
                                            accountOpts.userFirstName,
                                            accountOpts.userLastName,
                                            accountOpts.userPhone,
                                            accountOpts.userConfirmation
                                        ])})`,
                                    function(err: Error, results) {
                                        if (err) {throw err}
                                        let reason: StatusMessage = {
                                            error: false,
                                            message: 'User account created successfully'
                                        }
                                        let confirmationToken = sign({
                                            t: accountOpts.userConfirmation,
                                            action: 'r'
                                        },
                                        jwtSecret,
                                        {
                                            expiresIn: '30d'
                                        })
                                        sendConfirmation(
                                            {
                                                email: accountOpts.email, 
                                                confirmationToken
                                            }
                                        )
                                        .then(onEmailSent => {
                                            resolve(reason)
                                        }, onEmailNotSent => {
                                            reject(onEmailNotSent)
                                        })
                                        .catch(err => {
                                            throw err
                                        })
                                })
                            } else {
                                reject({
                                    error: true,
                                    message: 'Nonsig is not active'
                                })
                            }
                        }, (nonsigDoesNotExist) => {
                            reject(nonsigDoesNotExist)
                        })
                        .catch(err => {
                            throw err
                        })
                    }
                }
            )
        })
    } // newAccount() */

    public confirmAccount(password1, password2) {
        return new Promise((resolve, reject) => {
            if (
                this.userOpt.userConfirmation 
                && password1 
                && password2
            ) {
                verify(this.userOpt.userConfirmation, jwtSecret, (err, decoded: {t: string, g: string}) => {
                    if (err) {
                        if (err.name === 'TokenExpiredError' && decoded.g === 'r') {
                            reject({
                                error: true,
                                message: 'Account was not confirmed within 30 days. Please reregister.'
                            })
                        } else if (err.name === 'TokenExpiredError' && decoded.g === 'h') {
                            reject({
                                error: true,
                                message: 'Password was not reset within 1 hour. Please click on forgot password to restart password reset process.'
                            })
                        } else {
                            reject({
                                error: true,
                                message: 'Token is not valid. Please click on forgot password'
                            })
                        }
                    } else {
                        if (decoded.t) {
                            let hashed: string = ''
                            try {
                                hashed = this.verifyAndHashPassword(password1, password2)
                            } catch(err) {
                                reject({
                                    error: true,
                                    message: err.message
                                })
                            }
                            console.log(hashed)
                            let confirmUser = `
                                SELECT confirmUser(
                                    ${pool.escape([
                                        decoded.t,
                                        hashed
                                    ])}
                                ) AS confirmed
                            `
                            console.log(confirmUser)
                            pool.query(confirmUser, (err: Error, results) => {
                                if (err) {
                                    throw err
                                 } else {
                                    if (results[0].confirmed === 0) {
                                        resolve({
                                            error: false,
                                            message: 'Confirmed'
                                        })
                                    } else {
                                        reject({
                                            error: true,
                                            message: 'Key does not match confirmation.'
                                        })
                                    }
                                 }
                            })
                        } else {
                            reject({
                                error: true,
                                message: 'Missing user id or confirmation key.'
                            })
                        }
                    }
                })
            } else {
                reject({
                    error: true,
                    message: 'Missing User Id or Password or confirmation token'
                })
            }
        })
    }

    public verifyUsername() {
        return new Promise((resolve, reject) => {
            if (!this.userOpt.username || !this.userOpt.email) {
                throw new TypeError('No username or email provided to verify user against')
            } else {
                let conditions = []
                let sql = `
                    SELECT username, email
                    FROM sys_user
                    WHERE
                `
                if (this.userOpt.username) {
                    conditions.push(`username = ${pool.escape(this.userOpt.username.toLowerCase())}`)
                }
                if (this.userOpt.email) {
                    conditions.push(`email = ${pool.escape(this.userOpt.email.toLowerCase())}`)
                }
                sql += conditions.join(' OR ')
                pool.query(sql, (err: Error, results: Array<any>) => {
                    if (err) {
                        throw err
                     } else {
                        if (results.length === 0) {
                            resolve({
                                error: false,
                                message: 'Username available'
                            })
                        } else {
                            let message: Array<string> = []
                            for(let user of results) {
                                if (user.email === this.userOpt.email) {
                                    message.push('Email already in use. Please click on forgot password') 
                                } else if (user.username === this.userOpt.username) {
                                    message.push('Username already in use')
                                } else {
                                    message.push('User already exists')
                                }
                            }
                            resolve({
                                error: true,
                                message
                            })
                        }
                     }
                })
            }
        })
    }

    private verifyAndHashPassword(password1, password2): string {
        if (password1 !== password2) {
            throw new TypeError('Passwords do not match')
        } else if (!/[A-Z]/.test(password1)) {
            message: 'Passwords should contain an uppercase letter'
        } else if (!/[0-9]/.test(password1)) {
            throw new TypeError('Passwords should contain a number')
        } else if (password1.length < 8) {
            throw new TypeError('Password needs to be at least 8 characters long')
        } else if (password1.length > 50) {
            throw new TypeError('Passwords can not be over 50 characters long')
        } else {
            return hashSync(password1, saltRounds)
        }
    }

    public setPassword(password1, password2) {
        return new Promise((resolve, reject) => {
            if (this.userOpt.sys_id) {
                let hashed: string = ''
                try {
                    hashed = this.verifyAndHashPassword(password1, password2)
                } catch (err) {
                    reject({
                        error: true,
                        message: err.message
                    })
                }
                const sql = `
                    UPDATE sys_user
                    SET 
                        userPass = ${pool.escape(hashed)}
                    WHERE 
                        sys_id = ${pool.escape(this.userOpt.sys_id)}
                `
                pool.query(sql, (err: Error, results) => {
                    if (err) {throw err}
                    resolve({
                        error: false,
                        message: "Password set successfully."
                    })
                })
            } else {
                reject({
                    error: true,
                    message: 'Missing sys_id'
                })
            }
        })
    } // setPassword()

    /*
    public createNew(): Promise<StatusMessage> {
        return new Promise((resolve, reject) => {
            this.userOpt.sys_id = uuid.v4()
            let requiredFields = [
                'username',
                'email',
                'userNonsig',
                'userPhone',
                'userFirstName',
                'userLastName'
            ]
            let validator = new Validation(this.userOpt)
            let invalidFields = validator.required(requiredFields)
            if (invalidFields.length > 0) {
                reject({
                    error: true,
                    message: 'Invalid data',
                    details: invalidFields
                }) 
            } else {
                let defaultedFields = validator.truncate(
                    [
                        {
                            field: 'username',
                            length: 36
                        },
                        {
                            field: 'email',
                            length: 90
                        },
                        {
                            field: 'userDefaultNonsig',
                            length: 9
                        },
                        {
                            field: 'userFirstName',
                            length: 30
                        }, 
                        {
                            field: 'userLastName',
                            length: 30
                        }
                    ]
                ).defaults(
                    {
                        sys_id: uuid.v4(),
                        userConfirmation: uuid.v4()
                    }
                )
                this.newAccount(defaultedFields)
                .then(function(resolvedPromise) {
                    resolve(resolvedPromise) 
                }, function(rejectedPromise) {
                    reject(rejectedPromise)
                })
                .catch(function(err) {
                    throw err
                }) 
            }
        })
    } // createNew()
    */
}