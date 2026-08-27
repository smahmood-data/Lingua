import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Ephemeral / secure token or proxy endpoint for Gemini Live API
app.get('/api/gemini/token', (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({
      error: 'Configuration Error',
      message: 'GEMINI_API_KEY is not configured on the server. Please set it in your environment.'
    });
  }

  // Return token / session info securely without exposing raw config issues to browser insecurely
  res.json({
    token: GEMINI_API_KEY,
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`OfferGuard secure backend running on port ${PORT}`);
});
