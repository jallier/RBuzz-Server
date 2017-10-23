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

/**
 * Listen to Firebase server at node given by childNode.
 * Sends a notification to user specified in the received message
 * @param {String} childNode Node of Firebase db to listen at
 * @param {function} processMessage function to call to extract relevant data to send to client
 */
function listen(childNode, processMessage) {
  let messages = ref.child(childNode);
  messages.on('child_added', async snapshot => {
    let message = snapshot.val();
    console.log(childNode, message);
    if (process.argv[2] == 'debug') {
      console.log('delaying one second...');
      await wait(1000);
    }
    let data = processMessage(message);
    try {
      await sendNotifToUser(message.recipient, data);
      snapshot.ref.remove();
      console.log('removed message');
    } catch (e) {
      console.error(e);
      console.log('message not removed; continuing');
    }
  });
}

async function sendNotifToUser(recipient, data) {
  let userFCMKey = await getUser(recipient);
  let options = {
    url: 'https://fcm.googleapis.com/fcm/send',
    method: 'POST',
    headers: {
      'Content-Type': ' application/json',
      Authorization: 'key=' + FCM_API_KEY,
    },
    body: JSON.stringify({
      data,
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
    throw new Error(response);
  }
  console.log('Notification sent to:', userFCMKey);
  return true;
}

async function getUser(fbUid) {
  let users = ref.child('users');
  let user;
  let token;
  try {
    user = await users.child(fbUid).once('value');
    token = user.val().fcmToken;
  } catch (e) {
    console.error(e);
    return false;
  }
  return token;
}

function processMessagePattern(data) {
  return { pattern: data.pattern };
}

function processMessageContacts(data) {
  return { sender: data.from, recipient: data.to };
}

if (process.argv[2] == 'debug') {
  console.log('Starting server in debug mode...');
} else {
  console.log('Starting server...');
}

listen('messages', processMessagePattern);
listen('contactRequests', processMessageContacts);
