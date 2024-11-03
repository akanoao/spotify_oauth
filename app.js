const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
const querystring = require('querystring');
const cookieParser = require('cookie-parser');
const path = require('path');
// const { url } = require('inspector');
require('dotenv').config();

const app = express();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:8888/callback';

const generateRandomString = (length) =>{
  return crypto.randomBytes(length).toString('hex').slice(0, length)};

const stateKey = 'spotify_auth_state';

app.set("view engine", "ejs");
app.set('views', path.join(__dirname, 'views'));

app.use(express.static('public'));
app.use(cors());
app.use(cookieParser());

// Login endpoint: directs the user to Spotify's authorization page
app.get('/login', (req, res) => {
  const state = generateRandomString(16);
  res.cookie(stateKey, state);

  const scope = 'user-read-private user-read-email user-top-read user-read-currently-playing user-read-recently-played';
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
  // console.log(req.query);
  const code = req.query.code || null;
  const state = req.query.state || null;
  const storedState = req.cookies ? req.cookies[stateKey] : null;
  
  if (state === null || state !== storedState) {
    return res.redirect('/#' + querystring.stringify({ error: 'state_mismatch' }));
  } else {
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

      // Store tokens in HTTP-only cookies
      res.cookie('access_token', access_token, { httpOnly: true, secure: true, sameSite: 'Strict' });
      res.cookie('refresh_token', refresh_token, { httpOnly: true, secure: true, sameSite: 'Strict' });

      // Redirect to homepage or another page
      res.redirect('/profile'); // Change this to your desired landing page after login
    } catch (error) {
      console.error('Error fetching tokens:', error);
      res.redirect('/#' + querystring.stringify({ error: 'invalid_token' }));
    }
  }
});

// Profile endpoint: retrieves user profile data using the access token stored in cookies
app.get('/profile', async (req, res) => {
  const access_token = req.cookies.access_token;

  if (!access_token) {
    return res.status(401).send({ error: 'Access token missing or expired' });
  }

  try {
    // Fetch user's top tracks
    const topTracksOptions = {
      method: 'get',
      url: 'https://api.spotify.com/v1/me/top/tracks?limit=5',
      headers: { Authorization: `Bearer ${access_token}` }
    };
    const topTracksResponse = await axios(topTracksOptions);

    const topArtistsOptions = {
      method: 'get',
      url: 'https://api.spotify.com/v1/me/top/artists?limit=5',
      headers: { Authorization: `Bearer ${access_token}` }
    };
    const topArtistsResponse = await axios(topArtistsOptions);

    const profileOptions = {
      method: 'get',
      url: 'https://api.spotify.com/v1/me',
      headers: { Authorization: `Bearer ${access_token}` }
    };

    const profileResponse = await axios(profileOptions);
    const displayName = profileResponse.data.display_name;

    // Get currently playing track
    const currentlyPlayingOptions = {
      method: 'get',
      url: 'https://api.spotify.com/v1/me/player/currently-playing',
      headers: { Authorization: `Bearer ${access_token}` }
    };

    const currentlyPlayingResponse = await axios(currentlyPlayingOptions);
    const currentlyPlaying = currentlyPlayingResponse.data?.item
      ? {
          trackName: currentlyPlayingResponse.data.item.name,
          artistName: currentlyPlayingResponse.data.item.artists.map(artist => artist.name).join(', ')
        }
      : null;

    // Get recently played tracks
    const recentlyPlayedOptions = {
      method: 'get',
      url: 'https://api.spotify.com/v1/me/player/recently-played?limit=5',
      headers: { Authorization: `Bearer ${access_token}` }
    };

    const recentlyPlayedResponse = await axios(recentlyPlayedOptions);
    const recentlyPlayed = recentlyPlayedResponse.data.items.map(item => ({
      trackName: item.track.name,
      artistName: item.track.artists.map(artist => artist.name).join(', ')
    }));
    // Send both profile and top tracks data in the response
    // res.send({
    //   name: displayName,
    //   currentlyPlaying: currentlyPlaying,
    //   recentlyPlayed: recentlyPlayed,
    //   topTracks: topTracksResponse.data.items.map(item => item.name),
    //   topArtists: topArtistsResponse.data.items.map(item => item.name)
    // });

    res.render("main.ejs", {
      name: displayName,
      currentlyPlaying: currentlyPlaying,
      recentlyPlayed: recentlyPlayed,
      topTracks: topTracksResponse.data.items.map(item => item.name),
      topArtists: topArtistsResponse.data.items.map(item => item.name)
    });

  } catch (error) {
    console.error('Error fetching profile data:',  error.response ? error.response.data : error);
    res.status(500).send({ error: 'Failed to fetch profile data' });
  }
});


// Refresh token endpoint: requests a new access token using the refresh token
app.get('/refresh_token', async (req, res) => {
  const refresh_token = req.cookies.refresh_token; // Get refresh token from cookie

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

    // Update the access token cookie
    res.cookie('access_token', access_token, { httpOnly: true, secure: true, sameSite: 'Strict' });
    
    res.send({
      access_token: access_token
    });
  } catch (error) {
    console.error('Error refreshing token:', error);
    res.status(500).send({ error: 'failed_to_refresh_token' });
  }
});


console.log('Listening on 8888');
app.listen(8888);
