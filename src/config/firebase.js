const admin = require('firebase-admin');
const serviceAccount = require('../../serviceAccountKey.json');
const databaseURL =
  process.env.FIREBASE_DATABASE_URL ||
  `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`;

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL
  });
}

const db = admin.firestore();
const rtdb = admin.database();
const auth = admin.auth();

module.exports = { db, rtdb, auth, admin };
