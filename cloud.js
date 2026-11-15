// Mathlete family sign-in and sync, on Firebase. The page works without this file (local mode).
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously,
         signOut as fbSignOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, getDoc, setDoc, deleteDoc,
         onSnapshot } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const App = window.MathleteApp;
if (!firebaseConfig || !firebaseConfig.apiKey) {
  App.onState({ status: "off" });
} else {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  let fs;
  try { fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
  catch (e) { fs = initializeFirestore(app, {}); }

  const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // no 0/O or 1/I/L
  const newCode = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => ALPHABET[b % ALPHABET.length]).join("");
  const clean = c => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const say = e => {
    const c = (e && e.code) || "";
    if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return "That email and password do not match an account.";
    if (c.includes("email-already-in-use")) return "That email already has an account. Use Sign in.";
    if (c.includes("weak-password")) return "Use a password with 6 or more characters.";
    if (c.includes("invalid-email") || c.includes("missing-email")) return "Type a valid email address.";
    if (c.includes("missing-password")) return "Type a password.";
    if (c.includes("too-many-requests")) return "Too many tries. Wait a few minutes and try again.";
    if (c.includes("network") || c.includes("unavailable")) return "No connection. Check the internet and try again.";
    if (c.includes("permission-denied")) return "That code was not accepted. Check it and try again.";
    if (c.includes("operation-not-allowed")) return "This sign-in type is not turned on in Firebase yet.";
    return "Something went wrong (" + (c || "unknown") + "). Try again.";
  };

  // The page already knows how to sync a "profiles" collection; hand it this family's kids in that shape.
  const adapter = fid => ({
    collection() {
      return { onSnapshot(next, err) {
        return onSnapshot(collection(fs, "families", fid, "kids"), { includeMetadataChanges: true },
          s => next({ docs: s.docs.map(d => ({ id: d.id, exists: true, data: () => d.data() })), metadata: { fromCache: s.metadata.fromCache } }),
          e => err(e));
      } };
    },
    doc(path) {
      const ref = doc(fs, "families", fid, "kids", path.split("/")[1]);
      // Firestore queues writes itself, including offline, so do not make the page wait on the server.
      return { set(body) { setDoc(ref, body).catch(() => {}); return Promise.resolve(); },
               delete() { deleteDoc(ref).catch(() => {}); return Promise.resolve(); } };
    }
  });

  let busy = false;
  async function resolve(user) {
    if (busy) return;
    if (!user) { App.onState({ status: "out" }); return; }
    try {
      const u = await getDoc(doc(fs, "users", user.uid));
      const fid = u.exists() ? u.data().fid : null;
      const m = fid ? await getDoc(doc(fs, "families", fid, "members", user.uid)) : null;
      if (!m || !m.exists()) {
        if (user.isAnonymous) { await fbSignOut(auth); return; }
        App.onState({ status: "needFamily", email: user.email || "" }); return;
      }
      const role = m.data().role === "parent" ? "parent" : "device";
      const fam = await getDoc(doc(fs, "families", fid));
      let keys = null;
      if (role === "parent") { const k = await getDoc(doc(fs, "families", fid, "private", "keys")); keys = k.exists() ? k.data() : null; }
      App.onState({ status: "in", fid, role, email: user.email || "", db: adapter(fid),
        family: { name: fam.exists() ? fam.data().name : "Family", joinCode: keys && keys.joinCode, parentCode: keys && keys.parentCode } });
    } catch (e) { App.onState({ status: "error", error: say(e) }); }
  }
  onAuthStateChanged(auth, resolve);

  const guarded = fn => async (...args) => {
    busy = true;
    try { const r = await fn(...args); busy = false; if (!r) await resolve(auth.currentUser); return r || null; }
    catch (e) { busy = false; return say(e); }
  };

  window.MathleteCloud = {
    signIn: guarded(async (email, pw) => { await signInWithEmailAndPassword(auth, email, pw); }),
    signUp: guarded(async (email, pw) => { await createUserWithEmailAndPassword(auth, email, pw); }),
    async reset(email) { try { await sendPasswordResetEmail(auth, email); return null; } catch (e) { return say(e); } },
    async signOut() { try { await fbSignOut(auth); return null; } catch (e) { return say(e); } },

    createFamily: guarded(async name => {
      const user = auth.currentUser; if (!user || user.isAnonymous) return "Sign in as a parent first.";
      const fid = doc(collection(fs, "families")).id, joinCode = newCode(8), parentCode = newCode(8), now = Date.now();
      await setDoc(doc(fs, "families", fid), { name: String(name).slice(0, 24), owner: user.uid, created: now });
      await setDoc(doc(fs, "families", fid, "members", user.uid), { role: "parent", joined: now });
      await setDoc(doc(fs, "families", fid, "private", "keys"), { joinCode, parentCode });
      await setDoc(doc(fs, "codes", joinCode), { fid });
      await setDoc(doc(fs, "users", user.uid), { fid });
    }),

    joinParent: guarded(async (familyCode, parentCode) => {
      const user = auth.currentUser; if (!user || user.isAnonymous) return "Sign in as a parent first.";
      const c = await getDoc(doc(fs, "codes", clean(familyCode) || "-"));
      if (!c.exists()) return "That family code was not found.";
      const fid = c.data().fid;
      await setDoc(doc(fs, "families", fid, "members", user.uid), { role: "parent", code: clean(parentCode), joined: Date.now() });
      await setDoc(doc(fs, "users", user.uid), { fid });
    }),

    linkDevice: guarded(async familyCode => {
      const code = clean(familyCode); if (code.length < 6) return "Type the whole family code.";
      if (!auth.currentUser) await signInAnonymously(auth);
      const user = auth.currentUser;
      try {
        const c = await getDoc(doc(fs, "codes", code));
        if (!c.exists()) { if (user.isAnonymous) await fbSignOut(auth); return "That family code was not found."; }
        const fid = c.data().fid;
        await setDoc(doc(fs, "families", fid, "members", user.uid), { role: "device", code, joined: Date.now() });
        await setDoc(doc(fs, "users", user.uid), { fid });
      } catch (e) { if (user.isAnonymous) { try { await fbSignOut(auth); } catch (_) {} } throw e; }
    })
  };
}
