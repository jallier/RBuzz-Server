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
    let data = await processMessage(message);
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
  // let userFCMKey = await getUserFcmToken(recipient);
  let userFCMKey = await getUserFcmToken(recipient);
  console.log(userFCMKey);
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
  console.log('Notification sent to:', userFCMKey, data);
  return true;
}

async function getUserFcmToken(id) {
  let users = ref.child('users');
  let user;
  let token;
  if (id.indexOf('@') > -1) {
    user = await getUserWithEmail(users, id);
    let key;
    // Get the first child
    for (let i in user.val()) {
      key = i;
      break;
    }
    user = user.val()[key];
    token = user.fcmToken;
  } else {
    user = await getUserWithUID(users, id);
    token = user.val().fcmToken;
  }
  return token;
}

async function getUserWithEmail(users, email) {
  let user;
  user = await users
    .orderByChild('email')
    .equalTo(email)
    .once('value');
  return user;
}

async function getUserWithUID(users, uid) {
  let user;
  user = await users.child(uid).once('value');
  return user;
}

function processMessagePattern(data) {
  return { messageType: 'vibration', pattern: data.pattern };
}

async function processMessageContacts(data) {
  if (!data.sender.indexOf('@') > -1) {
    console.log('not from email address');
    let sender = await getUserWithUID(ref.child('users'), data.sender);
    sender = sender.val().email;
    return { messageType: 'contactRequest', sender, recipient: data.recipient };
  }
  return {
    messageType: 'contactRequest',
    sender: data.sender,
    recipient: data.recipient,
  };
}

if (process.argv[2] == 'debug') {
  console.log('Starting server in debug mode...');
} else {
  console.log('Starting server...');
}

listen('messages', processMessagePattern);
listen('contactRequests', processMessageContacts);
