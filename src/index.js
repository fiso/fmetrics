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

let consumerKey;
let consumerSecret;

function log (...args) {
  if (!dev) {
    return;
  }

  console.log(...args);
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
  return (d => `${
    d.getFullYear()}-${
    String(d.getMonth() + 1).padStart(2, '0')}-${
    String(d.getDate()).padStart(2, '0')}@${
    String(d.getHours()).padStart(2, '0')}:${
    String(d.getMinutes()).padStart(2, '0')}:${
    String(d.getSeconds()).padStart(2, '0')}`)(new Date());
}

function formatUser (user) {
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

async function getTwitterConfig () {
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

async function configure () {
  try {
    log('Making sure snapshot directory exists...');
    fs.mkdirSync(`${fileroot}snapshots`, {recursive: true});
  } catch (e) {
    if (e.code !== 'EEXIST') {
      console.error(
          `Fatal error: Failed to create directory ${fileroot}snapshots`);
      console.error(e);
      process.exit(1);
    }
  }

  const twitterConfig = await getTwitterConfig();
  consumerKey = twitterConfig.consumerKey;
  consumerSecret = twitterConfig.consumerSecret;

  passport.use(new TwitterStrategy({
    consumerKey,
    consumerSecret,
    callbackURL: '/callback',
  },
  function onRecieveCredentials (tokenKey, tokenSecret, profile, cb) {
    fs.writeFileSync(
        `${fileroot}clientsecrets-${profile.id}.json`, JSON.stringify(
            {tokenKey, tokenSecret}, null, 2,
        ),
    );
    log(`Saved credentials for ${profile.id}`);
    // resolve({tokenKey, tokenSecret});
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

  app.get('/auth',
      function (req, res) {
        if (!req.user) {
          return passport.authenticate('twitter')(req, res);
        } else {
          return res.send(`Authenticated as ${req.user.username}`);
        }
      });

  app.get('/callback',
      passport.authenticate('twitter'),
      function (req, res) {
        return res.redirect('/auth');
      });

  app.get('/',
      async function (req, res) {
        const twitterUserId = '14745143';

        // 1. Authenticate somehow, either via saved credentials or oauth flow
        log('Verifying credentials...');
        const {tokenKey, tokenSecret} = await (
          async function verifyCredentials () {
            try {
              const {tokenKey, tokenSecret} = require(
                  `${fileroot}clientsecrets-${twitterUserId}.json`);
              if (tokenKey && tokenSecret) {
                return {tokenKey, tokenSecret};
              }
            } catch (e) {
              // File not found
            }

            return {};
          })();

        // 1b. If authentication failed, we can't proceed
        if (!tokenKey || !tokenSecret) {
          console.error('Authentication failed, exiting');
          log('Need new credentials, starting OAuth flow...');
          return res.redirect('/auth');
        }

        // 2. Make repeated calls to followers/list.json until we've fetched all
        //    pages. Run the users through a formatting function and save them
        //    all in the returned array.
        log('Credentials verified, starting follower fetch...');
        const followers = await (async function () {
          let followers = [];
          let cursor = '-1';
          const twitterClient = new Twitter({
            consumer_key: consumerKey,
            consumer_secret: consumerSecret,
            access_token_key: tokenKey,
            access_token_secret: tokenSecret,
          });

          do {
            log(`Page ${cursor}...`);
            const page = await twitterClient.get('followers/list.json', {
              count: 200,
              skip_status: true,
              include_user_entities: false,
              cursor,
            });
            followers = followers.concat(page.users.map(formatUser));
            cursor = page.next_cursor_str;
            if (cursor === '0') {
              cursor = null;
            }
          } while (cursor);

          log('All pages fetched');
          return followers;
        })();

        // 3. Write the list of followers to a timestamped json file
        const filename = `${fileroot}snapshots/${timestamp()}.json`;
        log(`Saving snapshot ${filename}`);
        fs.writeFileSync(filename, JSON.stringify(
            followers, null, 2,
        ));

        return res.send('OK');
      });

  log('Starting server...');
  app.listen(4000);
}

log('Running in development mode');
configure();
