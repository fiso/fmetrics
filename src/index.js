process.on('unhandledRejection', (reason, p) => {
  console.error('Fatal error: Unhandled promise rejection!');
  console.error(reason);
  console.trace();
  process.exit(1);
});

const express = require('express');
const fs = require('fs');
const passport = require('passport');
const readline = require('readline');
const TwitterStrategy = require('passport-twitter');
const Twitter = require('twitter');

const dev = process.env.NODE_ENV === 'development';
const fileroot = dev ?
  `${__dirname}/../data/` :
  `${process.env.HOME}/.fmetrics/`;

if (dev) {
  console.log('Running in development mode');
}

try {
  fs.mkdirSync(`${fileroot}snapshots`, {recursive: true});
} catch (e) {
  if (e.code !== 'EEXIST') {
    console.error(
        `Fatal error: Failed to create directory ${fileroot}snapshots`);
    console.error(e);
    process.exit(1);
  }
}

function prompt (text) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(`${text} `, value => {
      rl.close();
      resolve(value);
    });
  });
}

function timestamp () {
  const d = new Date();
  return `${
    d.getFullYear()}-${
    String(d.getMonth() + 1).padStart(2, '0')}-${
    String(d.getDate()).padStart(2, '0')}@${
    String(d.getHours()).padStart(2, '0')}:${
    String(d.getMinutes()).padStart(2, '0')}:${
    String(d.getSeconds()).padStart(2, '0')}`;
}

async function getConfig () {
  const {consumerKey, consumerSecret} = await (async () => {
    try {
      return require(`${fileroot}appsecrets.json`);
    } catch (e) {
      console.error('Failed to find configuration file');
      const consumerKey = await prompt('Please enter your Consumer API key');
      const consumerSecret = await prompt(
          'Please enter your Consumer API secret key');
      fs.writeFileSync(`${fileroot}appsecrets.json`, JSON.stringify(
          {consumerKey, consumerSecret}, null, 2,
      ));
      return {consumerKey, consumerSecret};
    }
  })();

  if (!consumerKey || !consumerSecret) {
    console.error('Invalid configuration');
    process.exit(1);
  }

  return {consumerKey, consumerSecret};
}

function authenticate (consumerKey, consumerSecret) {
  return new Promise((resolve, reject) => {
    passport.use(new TwitterStrategy({
      consumerKey,
      consumerSecret,
      callbackURL: '/callback',
    },
    function (tokenKey, tokenSecret, profile, cb) {
      fs.writeFileSync(`${fileroot}clientsecrets.json`, JSON.stringify(
          {tokenKey, tokenSecret}, null, 2,
      ));
      resolve({tokenKey, tokenSecret});
      server.close();
      return cb(null, profile);
    }));

    passport.serializeUser(function (user, cb) {
      cb(null, user);
    });

    passport.deserializeUser(function (obj, cb) {
      cb(null, obj);
    });

    const app = express();

    app.use(require('body-parser').urlencoded({extended: true}));
    app.use(require('express-session')({
      secret: 'keyboard cat', resave: true, saveUninitialized: true}));

    app.use(passport.initialize());
    app.use(passport.session());

    app.get('/',
        function (req, res) {
          if (!req.user) {
            return passport.authenticate('twitter')(req, res);
          } else {
            return res.send(req.user ? req.user.username : 'no user');
          }
        });

    app.get('/callback',
        passport.authenticate('twitter'),
        function (req, res) {
          res.redirect('/');
        });

    const server = app.listen(4000);
    require('open')('http://localhost:4000');
  });
}

function filterUser (user) {
  return {
    id: user.id,
    id_str: user.id_str,
    name: user.name,
    screen_name: user.screen_name,
    followers_count: user.followers_count,
    friends_count: user.friends_count,
    verified: user.verified,
  };
}

async function fetchFollowers (consumerKey, consumerSecret) {
  const {tokenKey, tokenSecret} = await (async function () {
    try {
      const {tokenKey, tokenSecret} = require(`${fileroot}clientsecrets.json`);
      if (tokenKey && tokenSecret) {
        return {tokenKey, tokenSecret};
      }
    } catch (e) {
      // File not found
    }

    return await authenticate(consumerKey, consumerSecret);
  })();

  if (!tokenKey || !tokenSecret) {
    process.exit(1);
  }

  const twitterClient = new Twitter({
    consumer_key: consumerKey,
    consumer_secret: consumerSecret,
    access_token_key: tokenKey,
    access_token_secret: tokenSecret,
  });

  const followers = await (async function () {
    let followers = [];
    let cursor = '-1';
    do {
      const page = await twitterClient.get('followers/list.json', {
        count: 200,
        skip_status: true,
        include_user_entities: false,
        cursor,
      });
      followers = followers.concat(page.users.map(filterUser));
      cursor = page.next_cursor_str;
      if (cursor === '0') {
        cursor = null;
      }
    } while (cursor);
    return followers;
  })();

  fs.writeFileSync(`${fileroot}snapshots/${timestamp()}.json`, JSON.stringify(
      followers, null, 2,
  ));
}

async function performUpdate () {
  const {consumerKey, consumerSecret} = await getConfig();
  fetchFollowers(consumerKey, consumerSecret);
}

performUpdate();
