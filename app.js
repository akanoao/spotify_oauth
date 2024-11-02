const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
const querystring = require('querystring');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:8888/callback';

const generateRandomString = (length) =>{
  crypto.randomBytes(length).toString('hex').slice(0, length)};

const stateKey = 'spotify_auth_state';

app.use(express.static(__dirname + '/public'))
.use(cors())
.use(cookieParser());

// Login endpoint: directs the user to Spotify's authorization page
app.get('/login', (req, res) => {
  const state = generateRandomString(16);
  res.cookie(stateKey, state);

  const scope = 'user-read-private user-read-email';
  const authURL = `https://accounts.spotify.com/authorize?${querystring.stringify({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: scope,
    redirect_uri: REDIRECT_URI,
    state: state
  })}`;

  res.redirect(authURL);
});

// Callback endpoint: handles Spotify's response with the authorization code
app.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  const state = req.query.state || null;
  const storedState = req.cookies ? req.cookies[stateKey] : null;

  if (state === null || state !== storedState) {
    return res.redirect('/#' + querystring.stringify({ error: 'state_mismatch' }));
  } 
  else {
    res.clearCookie(stateKey);

    try {
      const authOptions = {
        method: 'post',
        url: 'https://accounts.spotify.com/api/token',
        data: querystring.stringify({
          code: code,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code'
        }),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`
        }
      };

      const tokenResponse = await axios(authOptions);
      const { access_token, refresh_token } = tokenResponse.data;

      // Retrieve user data
      const userOptions = {
        method: 'get',
        url: 'https://api.spotify.com/v1/me',
        headers: { Authorization: `Bearer ${access_token}` }
      };

      const userProfile = await axios(userOptions);
      console.log(userProfile.data);

      // Redirect to homepage with tokens
      res.redirect('/#' + querystring.stringify({
        access_token: access_token,
        refresh_token: refresh_token
      }));
    } catch (error) {
      console.error('Error fetching tokens:', error);
      res.redirect('/#' + querystring.stringify({ error: 'invalid_token' }));
    }
  }
});

// Refresh token endpoint: requests a new access token using the refresh token
app.get('/refresh_token', async (req, res) => {
  const { refresh_token } = req.query;

  try {
    const authOptions = {
      method: 'post',
      url: 'https://accounts.spotify.com/api/token',
      data: querystring.stringify({
        grant_type: 'refresh_token',
        refresh_token: refresh_token
      }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`
      }
    };

    const tokenResponse = await axios(authOptions);
    const { access_token } = tokenResponse.data;

    res.send({
      access_token: access_token,
      refresh_token: refresh_token // re-send if refreshed, or omit if unchanged
    });
  } catch (error) {
    console.error('Error refreshing token:', error);
    res.status(500).send({ error: 'failed_to_refresh_token' });
  }
});

console.log('Listening on 8888');
app.listen(8888);
