const path = require('path');
const express = require('express');
const OpenAI = require('openai');
const sqlite3 = require('sqlite3');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const axios = require('axios');

console.log('Directory name:', __dirname);
console.log('Full .env path:', path.join(__dirname, '../.env'));
require('dotenv').config({ path: path.join(__dirname, '../.env') });
console.log('Environment variables loaded:', {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'Present' : 'Missing',
    ASSISTANT_ID: process.env.ASSISTANT_ID ? 'Present' : 'Missing'
});

const app = express();
app.use(express.json());

// Session management for logging
app.use(session({
    secret: 'random_string', // TODO: Replace with a secure secret
    resave: false,
    saveUninitialized: true
}));

app.use(cookieParser());
app.use((req, res, next) => {
    const authUser = req.cookies.auth_user; // Read cookie from request

    if (!authUser) {
        return res.redirect('http://localhost:8000/php/login.php');
    }

    // Store user in session
    req.session.user = authUser; 
    next();
});

// Serve static files from the frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

// Configure sqlite
const db = new sqlite3.Database('chat.logs');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS Logs (
        SessionID TEXT, 
        dt DATETIME DEFAULT CURRENT_TIMESTAMP, 
        UserQuery TEXT, 
        Response TEXT
    )`);
});

// Configure OpenAI API with correct initialization
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

app.post('/api/chat', async (req, res) => {
    try {
        const userInput = req.body.message;
        const thread = await openai.beta.threads.create();

        await openai.beta.threads.messages.create(
            thread.id,
            { role: "user", content: userInput }
        );

        const run = await openai.beta.threads.runs.create(
            thread.id,
            { assistant_id: process.env.ASSISTANT_ID }
        );

        let runStatus = await openai.beta.threads.runs.retrieve(
            thread.id,
            run.id
        );
        while (runStatus.status !== 'completed') {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
            runStatus = await openai.beta.threads.runs.retrieve(
                thread.id,
                run.id
            );
        }

        const messages = await openai.beta.threads.messages.list(
            thread.id
        );
        const assistantResponse = messages.data[0].content[0].text.value;

        const stmt = db.prepare("INSERT INTO Logs (SessionID, UserQuery, Response) VALUES (?, ?, ?)");
        stmt.run(req.sessionID, userInput, assistantResponse);

        res.json({ response: assistantResponse });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/logs', (req, res) => {
    db.all("SELECT * FROM Logs ORDER BY dt DESC", (err, rows) => {
        if (err) {
            console.error('Error fetching logs:', err);
            return res.status(500).json({ error: 'Failed to fetch logs' });
        }
        res.json({ logs: rows });
    });
});

app.get('/api/logs/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    db.all("SELECT * FROM Logs WHERE SessionID = ? ORDER BY dt DESC", [sessionId], (err, rows) => {
        if (err) {
            console.error('Error fetching logs:', err);
            return res.status(500).json({ error: 'Failed to fetch logs' });
        }
        res.json({ logs: rows });
    });
});

app.delete('/api/deleteAllLogs', (req, res) => {
    db.run("DELETE FROM Logs", function(err) {
        if (err) {
            console.error('Error deleting logs:', err);
            return res.status(500).json({ error: 'Failed to delete logs' });
        }
        res.status(200).json({ message: 'All logs deleted' });
    });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
