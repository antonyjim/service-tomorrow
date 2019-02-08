/**
 * Start the web server
 */

import { readFileSync } from 'fs';


import routes from './app'
const dotenv = require('dotenv')
const envConfig = dotenv.parse(readFileSync(__dirname + '/../dot.env'))

for (let k in envConfig) {
    process.env[k] = envConfig[k]
}

routes()