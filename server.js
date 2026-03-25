const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const multer = require('multer');
const fs = require('fs'); 
const db = require('./db'); 
const transporter = require('./mailer'); 
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 1. STATIC FOLDERS
app.use('/Uploads', express.static(path.join(__dirname, 'Uploads'))); 
app.use(express.static('public')); 

// 2. MULTER CONFIGURATION
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'Uploads/'); 
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// 3. API ROUTES

// Test Route
app.get('/', (req, res) => {
    res.send('Activity 17 Backend is Running! 🚀');
});

// Registration
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    const verificationToken = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '1d' });

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const query = 'INSERT INTO users (username, email, password, verification_token) VALUES (?, ?, ?, ?)';
        
        db.query(query, [username, email, hashedPassword, verificationToken], (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'Email already exists!' });
                return res.status(500).json({ error: err.message });
            }

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: email,
                subject: 'Verify your Account - Activity 17',
                html: `<h1>Hello ${username}!</h1><p>Click <a href="http://localhost:5000/api/verify/${verificationToken}">here</a> to verify.</p>`
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) return res.status(500).json({ message: "Error sending email." });
                res.status(201).json({ message: 'Registered! Check your email.' });
            });
        });
    } catch (error) {
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Email Verification
app.get('/api/verify/:token', (req, res) => {
    const { token } = req.params;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const query = 'UPDATE users SET is_verified = 1, verification_token = NULL WHERE email = ?';
        db.query(query, [decoded.email], (err, result) => {
            if (err) return res.status(500).send('Database error');
            res.send('<h1>Account Verified! ✅</h1><p>You can now login.</p>');
        });
    } catch (error) {
        res.status(400).send('Invalid or expired token.');
    }
});

// Forgot Password
app.post('/api/forgot-password', (req, res) => {
    const { email } = req.body;
    
    db.query('SELECT * FROM users WHERE email = ?', [email], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ message: 'Email not found!' });

        const resetToken = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '15m' });
        
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,  
            subject: 'PASSWORD RESET - ACTIVITY 17',
            html: `
                <div style="background: #0a0a0a; color: #00ff41; padding: 20px; font-family: monospace; border: 2px solid #00ff41;">
                    <h2>TERMINAL_PASSWORD_RESET</h2>
                    <p>Click the link below to reset your access key:</p>
                    <a href="http://localhost:5000/reset-password.html?token=${resetToken}" 
                       style="color: #000; background: #00ff41; padding: 10px; text-decoration: none; font-weight: bold;">
                       RESET_PASSWORD_NOW
                    </a>
                    <p>This link will expire in 15 minutes.</p>
                </div>`
        };

        transporter.sendMail(mailOptions, (error) => {
            if (error) return res.status(500).json({ message: "Error sending email." });
            res.json({ message: 'Reset link sent! Check your inbox.' });
        });
    });
});

// Login
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const query = 'SELECT * FROM users WHERE email = ?';
    db.query(query, [email], async (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ message: 'User not found!' });

        const user = results[0];
        if (user.is_verified === 0) return res.status(401).json({ message: 'Verify your email first!' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: 'Invalid credentials!' });

        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.json({ message: 'Login successful!', token: token });
    });
});

// Profile Picture Upload (with cleanup)
app.post('/api/upload-profile', upload.single('profile_pic'), (req, res) => {
    const { userId } = req.body;
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const newFilename = req.file.filename;

    db.query('SELECT profile_pic FROM users WHERE id = ?', [userId], (err, results) => {
        if (!err && results.length > 0) {
            const oldFilename = results[0].profile_pic;

            if (oldFilename && oldFilename !== 'default.png') {
                const oldFilePath = path.join(__dirname, 'Uploads', oldFilename);
                if (fs.existsSync(oldFilePath)) {
                    fs.unlinkSync(oldFilePath); 
                    console.log(`Deleted old file: ${oldFilename}`);
                }
            }
        }

        const updateQuery = 'UPDATE users SET profile_pic = ? WHERE id = ?';
        db.query(updateQuery, [newFilename, userId], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ 
                message: 'Avatar Updated!', 
                filename: newFilename,
                imageUrl: `/Uploads/${newFilename}` 
            });
        });
    });
});

// 4. SERVER LISTEN
const PORT = 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running sa http://localhost:${PORT}`);
});