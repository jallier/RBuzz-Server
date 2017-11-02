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
    if (data === null) {
      console.log('Data processed but returned null; no data notification to send');
    } else {
      try {
        await sendNotifToUser(message.recipient, data);
      } catch (e) {
        console.error(e);
        console.log('message not removed; continuing');
      }
    }
    snapshot.ref.remove();
    console.log('removed message from queue');
    console.log();
  });
}

/**
 * Send a data notification to to user specified by Firebase Google uid
 * @param {String} recipient Id of the notification recipient 
 * @param {*} data object representing data to send to recipient 
 */
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

/**
 * Get the users stored FCM Token from the database.
 * @param {String} id The Firebase Google uid stored in the Firebase database.
 * @returns {Promise<string>}
 */
async function getUserFcmToken(id) {
  id = id.trim();
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

/**
 * Finds a user node given an email address
 * @param {*} users Firebase reference to /users
 * @param {String} email Address to look up user for
 */
async function getUserWithEmail(users, email) {
  let user;
  user = await users
    .orderByChild('email')
    .equalTo(email)
    .once('value');
  return user;
}

/**
 * Finds and returns a user node given their uid
 * @param {*} users Firebase reference to /users
 * @param {String} uid Firebase Google uid of user to find
 */
async function getUserWithUID(users, uid) {
  let user;
  user = await users.child(uid).once('value');
  return user;
}

/**
 * Process the input when a user node is modified in Firebase and return it suitable for the app to receive
 * @param {*} data input data object
 */
function processMessagePattern(data) {
  return { messageType: 'vibration', pattern: data.pattern };
}

/**
 * Process the input when a contactRequest node is modified in Firebase. Returns either the correct data to send request to user, or null if user has accepted.
 * @param {*} data The input data to process.
 */
async function processMessageContacts(data) {
  switch (data.type) {
    case "contactRequest":
      return await handleContactRequest(data);
    case "contactAccept":
      await handleContactAccept(data);
      return null;
  }
}

/**
 * Write the users accepted contact info to their node in /users. Return null as no notification needs to be sent.
 * @param {*} data input data to process
 */
async function handleContactAccept(data) {
  console.log('Adding contact info to user', data);
  let user = ref.child('users').child(data.sender);
  let update = {
    'contacts': {
      [data.sender]: data.recipient
    }
  };
  user.update(update);
}

/**
 * Return the data with email addresses replacing any uid for text processing on the app
 * @param {*} data 
 */
async function handleContactRequest(data) {
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