const admin = require('firebase-admin');
const r = require('request');
const request = require('request-promise');
const serviceAcc = require('./serviceAccountKey.json');
const FCM_API_KEY = require('./fcmKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAcc),
  databaseURL: 'https://rbuzz-c9ce9.firebaseio.com/',
});

let db = admin.database();
let ref = db.ref();

// Simple delay function
let wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function listenForNewMessages() {
  if (process.argv[2] == 'debug') {
    console.log('Starting server in debug mode...');
  } else {
    console.log('Starting server...');
  }
  let messages = ref.child('messages');
  messages.on('child_added', async snapshot => {
    let message = snapshot.val();
    console.log(message);
    if (process.argv[2] == 'debug') {
      console.log('delaying one second...');
      await wait(1000);
    }
    let success = await sendNotifToUser(message.recipient, message.pattern);
    snapshot.ref.remove();
    console.log('removed message');
  });
}

async function sendNotifToUser(recipient, pattern) {
  let userFCMKey = await getUser(recipient);
  let options = {
    url: 'https://fcm.googleapis.com/fcm/send',
    method: 'POST',
    headers: {
      'Content-Type': ' application/json',
      Authorization: 'key=' + FCM_API_KEY,
    },
    body: JSON.stringify({
      data: {
        pattern: pattern,
      },
      to: userFCMKey,
    }),
  };
  let response;
  try {
    response = await request(options);
  } catch (error) {
    console.error(error.message);
    response = error;
  }
  if (response.statusCode >= 400) {
    console.error('http error:', response.statusCode);
    return false;
  }
  console.log('Notification sent to:', userFCMKey);
  return true;
}

async function getUser(fbUid) {
  let users = ref.child('users');
  let user;
  try {
    user = await users.child(fbUid).once('value');
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
  let token = user.val().fcmToken;
  return token;
}

listenForNewMessages();
