/**
 * This is an example of a basic node.js script that performs
 * the Authorization Code oAuth2 flow to authenticate against
 * the Spotify Accounts.
 *
 * For more information, read
 * https://developer.spotify.com/web-api/authorization-guide/#authorization_code_flow
 */

var express        = require('express'); // Express web server framework
var session        = require('express-session');
var passport       = require('passport');
var OAuth2Strategy = require('passport-oauth').OAuth2Strategy;
var request        = require('request'); // "Request" library
var querystring    = require('querystring');
var cookieParser   = require('cookie-parser');


var IPaddr = 'localhost:3001'

//Replace with files in gitignore eventually
//Spotify
var client_id = '0ad3baa2a6564528b19f0ddc20a0a0dd'; // Your client id
var client_secret = '23ff4e07ee6b49fa9fefb41055bf2110'; // Your secret
var redirect_uri = 'http://' + IPaddr +'/callback'; // Your redirect uri
// Define our constants, you will change these with your own
//Twitch
const TWITCH_CLIENT_ID = 'knv8w13jo39s9gg3dxpa6bqziy1ujh';
const TWITCH_SECRET    = '1qfs34yu838pcrljo87ljxm1xu7400';
const SESSION_SECRET   = 'mytestsecret';
const CALLBACK_URL     = 'http://' + IPaddr +'/auth/twitch/callback';  // You can run locally with - http://localhost:3000/auth/twitch/callback


/**
 * Generates a random string containing numbers and letters
 * @param  {number} length The length of the string
 * @return {string} The generated string
 */
var generateRandomString = function(length) {
  var text = '';
  var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (var i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

var stateKey = 'spotify_auth_state';

var app = express();


//Middleware for Spotify
//app.use(express.static(__dirname + '/public'))
//app.use(cors())
app.use(cookieParser());

app.use(function(req,res,next){
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});


//Middleware for spotify
app.use(session({secret: SESSION_SECRET, resave: false, saveUninitialized: false}));
//app.use(express.static('public'));
app.use(passport.initialize());
app.use(passport.session());


/*Twitch Authorization to ensure owner of stream*/
// Override passport profile function to get user profile from Twitch API
OAuth2Strategy.prototype.userProfile = function(accessToken, done) {
  var options = {
    url: 'https://api.twitch.tv/helix/users',
    method: 'GET',
    headers: {
      'Client-ID': TWITCH_CLIENT_ID,
      'Accept': 'application/vnd.twitchtv.v5+json',
      'Authorization': 'Bearer ' + accessToken
    }
  };

  request(options, function (error, response, body) {
    if (response && response.statusCode == 200) {
      done(null, JSON.parse(body));
    } else {
      done(JSON.parse(body));
    }
  });
}

passport.serializeUser(function(user, done) {
    done(null, user);
});

passport.deserializeUser(function(user, done) {
    done(null, user);
});

passport.use('twitch', new OAuth2Strategy({
    authorizationURL: 'https://id.twitch.tv/oauth2/authorize',
    tokenURL: 'https://id.twitch.tv/oauth2/token',
    clientID: TWITCH_CLIENT_ID,
    clientSecret: TWITCH_SECRET,
    callbackURL: CALLBACK_URL,
    state: true
  },
  function(accessToken, refreshToken, profile, done) {
    profile.accessToken = accessToken;
    profile.refreshToken = refreshToken;

    // Securely store user profile in your DB
    //User.findOrCreate(..., function(err, user) {
    //  done(err, user);
    //});

    done(null, profile);
  }
));

// Set route to start OAuth link, this is where you define scopes to request
app.get('/auth/twitch', passport.authenticate('twitch', { scope: '' }));

// Set route for OAuth redirect
app.get('/auth/twitch/callback', passport.authenticate('twitch', { successRedirect: '/registerstream', failureRedirect: '/' }));

// If user has an authenticated session, display it, otherwise display link to authenticate
app.get('/', function (req, res) {
  if(req.session && req.session.passport && req.session.passport.user) {
    console.log('at root /');
    res.sendStatus(204);
  } else {
    res.sendFile(__dirname + "/public/index.html");
  }
});

app.get('/registerstream', function(req, res) {
  console.log();
  console.log(req.session.passport.user.data[0].login);
  console.log("Twitch Auth Cookie created")
  res.cookie('twitchID', req.session.passport.user.data[0].login);

  //revokes twitch token to ensure no security issues
  var url = 'https://id.twitch.tv/oauth2/revoke?client_id=' + TWITCH_CLIENT_ID + '&token=' + req.session.passport.user.accessToken;
  //Requests tokens
  request.post(url, function(error, response, body){
    console.log('Twitch Token revoked');
  });

  res.redirect('/streamer/login');
  
});



//require twitch OAuth first
app.get('/streamer/login', function(req, res) {
  var state = generateRandomString(16);
  res.cookie(stateKey, state);
  var redirect_uri = 'http://' + IPaddr +'/loggedin';
  // your application requests authorization
  var scope = 'user-read-playback-state user-read-private';
  res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: client_id,
      scope: scope,
      redirect_uri: redirect_uri,
      state: state
    })
  );
});

app.get('/loggedin', function(req, res) {

  // your application requests re fresh and access tokens
  // after checking the state parameter

  var code = req.query.code || null;
  var state = req.query.state || null;
  var storedState = req.cookies ? req.cookies[stateKey] : null;
  console.log('logged in');

  if (state === null || state !== storedState) {
    res.redirect('/#' +
      querystring.stringify({
        error: 'state_mismatch'
      }));
  } else {
    var streamerID = req.cookies['twitchID'];
    res.clearCookie('twitchID');
    res.clearCookie(stateKey);

    //Set Authorization options for post to get tokens
    var authOptions = {
      url: 'https://accounts.spotify.com/api/token',
      form: {
        code: code,
        redirect_uri: 'http://' + IPaddr +'/loggedin',
        grant_type: 'authorization_code'
      },
      headers: {
        'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64'))
      },
      json: true
    };
    console.log('getting tokens')
    //Requests tokens
    request.post(authOptions, function(error, response, body) {
      if (!error && response.statusCode === 200) {
        //Get tokens from response
        console.log('tokens received')
        console.log(body);
        var access_token = body.access_token;
        var refresh_token = body.refresh_token;

        //Check to make sure they have premium
        var options = {
          url: 'https://api.spotify.com/v1/me',
          headers: { 'Authorization': 'Bearer ' + access_token },
          json: true
        };
        request.get(options, function(error, response, body){
          console.log(body);
          var premium = (body.product == "premium");
          //
          if(1){ //replace to premium when deploying

            var options = {
              url: 'https://api.spotify.com/v1/me/player/currently-playing',
              headers: { 'Authorization': 'Bearer ' + access_token },
              json: true
            };

            // use the access token to access the Spotify Web API, make call for initial information (get current song)
            request.get(options, function(error, response, body) {      
              console.log("Streamer Info received");
              //Add streamer to DB
              //console.log(body);
              if(body){
                var current_song = body['item']['id'];
                streams[streamerID] = {
                  songID: current_song,
                  access: access_token,
                  refresh: refresh_token,
                  viewers: []
                };
                setTimeout(checkSong, 10000, streamerID, body['progress_ms'], current_song);
              } else {
                streams[streamerID] = {
                  songID: '',
                  access: access_token,
                  refresh: refresh_token,
                  viewers: []
                }
              }
            });
            res.redirect('/registered');
          }
          else {
            res.send('premium required')
          }
        });

        
        // we can also pass the token to the browser to make requests from there
        
      } else {
        res.redirect('/#' +
          querystring.stringify({
            error: 'invalid_token'
          })
        );
      }
    });
  }
});

app.get('/registered', function(req, res) {
  console.log("registered")
  res.send('registered');
  
});




//Add viewers to listen
app.get('/viewer/listen', function(req, res) {
  var state = generateRandomString(16);
  res.cookie(stateKey, state);
  var stream = req.query.stream;
  console.log(stream);
  res.cookie("stream", stream);
  var redirect_uri = 'http://' + IPaddr +'/viewer/loggedin';
  // your application requests authorization
  var scope = 'user-modify-playback-state';
  res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: client_id,
      scope: scope,
      redirect_uri: redirect_uri,
      state: state
    })
  );
});

app.get('/viewer/loggedin', function(req, res) {

  // your application requests re fresh and access tokens
  // after checking the state parameter
  var code = req.query.code || null;
  var state = req.query.state || null;
  var storedState = req.cookies ? req.cookies[stateKey] : null;
  console.log('viewer logged in');

  if (state === null || state !== storedState) {
    res.redirect('/#' +
      querystring.stringify({
        error: 'state_mismatch'
      }));
  } else {
    var stream = req.cookies['stream'];
    res.clearCookie('stream');
    res.clearCookie(stateKey);

    //Set Authorization options for post to get tokens
    var authOptions = {
      url: 'https://accounts.spotify.com/api/token',
      form: {
        code: code,
        redirect_uri: 'http://' + IPaddr +'/viewer/loggedin',
        grant_type: 'authorization_code'
      },
      headers: {
        'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64'))
      },
      json: true
    };
    console.log('getting viewer tokens');
    //Requests tokens
    request.post(authOptions, function(error, response, body) {
      if (!error && response.statusCode === 200) {
        //Get tokens from response
        console.log('tokens received');
        var access_token = body.access_token;
        var refresh_token = body.refresh_token;
        var options = {
          url: 'https://api.spotify.com/v1/me',
          headers: { 'Authorization': 'Bearer ' + access_token },
          json: true
        };

        // use the access token to access the Spotify Web API, make call for initial information (get current song)
        request.get(options, function(error, response, body) {      
          console.log("Viewer Info received");
          //Add streamer to DB
          
          var user_id = body["id"];
          users[user_id] = {
            access: access_token,
            refresh: refresh_token,
            listening: true
          }
          streams[stream].viewers.push(user_id);
          //Get current song of streamer
          var streamer_token = streams[stream].access;
          var options = {
            url: 'https://api.spotify.com/v1/me/player/currently-playing',
            headers: { 'Authorization': 'Bearer ' + streamer_token },
            json: true
          };

          request.get(options, function(error, response, body) {
            var current_song = body['item']['id'];
            var song_uri = "spotify:track:" + current_song;
            var current_location = body['progress_ms'];
            var paused = body['is_playing'];
            if(paused){
              var authOptions = {
                url: 'https://api.spotify.com/v1/me/player/play',
                headers: { 
                  'Authorization': 'Bearer ' + access_token,
                  'Accept': 'application/json',
                  'Content-Type': 'application/json',
                },
                body: {
                  "uris": [song_uri],
                  "position_ms": current_location,
                },
                json: true,
              };
              console.log('changing song')
              request.put(authOptions, function(error, response, body){
                //console.log(body);
              });
            }
            
          });
        });
        // we can also pass the token to the browser to make requests from there
        res.redirect('/viewer/registered');
      } else {
        res.redirect('/#' +
          querystring.stringify({
            error: 'invalid_token'
          })
        );
      }
    });
  }
});

app.get('/viewer/registered', function(req, res) {
  console.log("viewer registered");
  res.send('viewer registered ');
  
});

//Whether actively listening to stream or not
app.get('/viewer/toggle', function(req, res) {
  console.log("viewer toggled");
  var user = req.query["user_id"];
  users[user].listening = !users[user].listening;
  res.sendStatus(204);
});


//Temporary DB
var users = {
  "userid1": {
    "access": "auth token",
    "refersh": "refresh token",
    "listening": true
  }
}

//holder for data structure to be used
var streams = {
  "streamer": {
    song: "songid",
    viewers: {
      "userid1": "listening", 
      "userid2": "notlistening"
    },
    access: "auth token",
    refersh: "refresh token"
  }
}



//Functionality to ensure music remains synced
function checkSong(streamer, lastChecked, song) {
  var access_token = streams[streamer].access;
  var options = {
    url: 'https://api.spotify.com/v1/me/player/currently-playing',
    headers: { 'Authorization': 'Bearer ' + access_token },
    json: true
  };
  var current_song = song;
  var current_location = lastChecked;
  var playing = true;
  request.get(options, function(error, response, body) {
    current_song = body['item']['id'];
    current_location = body['progress_ms'];
    playing = body['is_playing'];

    //console.log('Current Song: ' + current_song + ' | Last song: ' + song);
    //console.log('Current Time: ' + current_location + ' | Last time: ' + lastChecked);
    //console.log('Currently Listening: ' + playing);

    //music has been paused
    if(!playing){
      console.log("Paused Song");

      for(i=0; i< streams[streamer].viewers.length; i++){
        var user_id = streams[streamer].viewers[i];
        var listening = users[user_id].listening;

        //Change song if listening
        if(listening){
          var viewer_token = users[user_id].access;
          var authOptions = {
            url: 'https://api.spotify.com/v1/me/player/pause',
            headers: { 
              'Authorization': 'Bearer ' + viewer_token,
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
          };
          
          request.put(authOptions, function(error, response, body){
            //console.log(body);
            console.log('Paused User ' + user_id + '\'s music.');
          });
        }
        
      }
      setTimeout(checkSong, 10000, streamer, current_location, current_song);
    }

    //Song position or song has been changed
    else if ((current_song != song) || (current_location > lastChecked+1500) || (current_location < lastChecked+500)){
      console.log('Changed song');
      var song_uri = "spotify:track:" + current_song;

      //Change song of all listening
      for(i=0; i< streams[streamer].viewers.length; i++){
        var user_id = streams[streamer].viewers[i];
        var listening = users[user_id].listening;

        //Change song if listening
        if(listening){
          var viewer_token = users[user_id].access;
          var authOptions = {
            url: 'https://api.spotify.com/v1/me/player/play',
            headers: { 
              'Authorization': 'Bearer ' + viewer_token,
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
            body: {
              "uris": [song_uri],
              "position_ms": current_location,
            },
            json: true,
          };
          
          request.put(authOptions, function(error, response, body){
            console.log('Changed User ' + user_id + '\'s song.');
          });
        }
        
      }
      setTimeout(checkSong, 1000, streamer, current_location, current_song);
    }
    else{
      //Song is the same
      setTimeout(checkSong, 1000, streamer, current_location, song);
    }


  });


  
  //do something if paused


  //var song_length[duration_ms: 188493]
}


app.listen(3001);
console.log("Listening on Port 8888");

