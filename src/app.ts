/**
 * app.ts
 * Provide an entry point for the THQ application
*/

// Node Modules


// NPM Modules
import * as express from 'express'

// Local Modules
import { router } from './routes/routes.index'

// Constants and global variables
const app = express()
const port = 8080

// Routes
app.use('/', router)

app.listen(port, function() {
    console.log(`Listening on port ${port}`);
})