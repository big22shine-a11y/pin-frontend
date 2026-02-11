// 画像とピンを包む要素を取得
const wrapper = document.getElementById("image-wrapper");

// ピン情報表示エリア
const pinInfo = document.getElementById("pin-info");

// ピンのコメント表示用要素
const pinComment = document.getElementById("pin-comment");

// ピン削除ボタン
const deleteButton = document.getElementById("delete-pin-button");

// 色選択ラジオボタンをすべて取得
const colorRadios = document.querySelectorAll('input[name="pinColor"]');

// 現在選択中のピンの色（初期値）
let currentColor = "red";

// 現在選択されているピン（削除対象）
let selectedPin = null;

// Firebase Realtime Database 参照（null なら未設定）
let db = null;

// デバッグログ：スクリプト読み込み確認
console.log('script.js loaded - firebase defined?', typeof firebase !== 'undefined');

// セッションIDを生成（このブラウザセッション固有のID）
const sessionId = 'user-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now();
console.log('Session ID:', sessionId);

/* ===== 色選択処理 ===== */
colorRadios.forEach((radio) => {
  radio.addEventListener("change", () => {
    currentColor = radio.value;
  });
});

/* ===== Firebase 初期化（ページ上で window.FIREBASE_CONFIG を設定している場合） ===== */
if (window.FIREBASE_CONFIG && typeof firebase !== "undefined") {
  try {
    firebase.initializeApp(window.FIREBASE_CONFIG);
    db = firebase.database();
    console.log('Firebase initialized in script.js, db ready:', !!db);
  } catch (err) {
    console.warn("Firebase init failed:", err);
    db = null;
  }
}

// 追加の保険: page load 時にも未初期化なら再試行
window.addEventListener('load', () => {
  try {
    if (window.FIREBASE_CONFIG && typeof firebase !== 'undefined') {
      if (!firebase.apps || firebase.apps.length === 0) {
        firebase.initializeApp(window.FIREBASE_CONFIG);
        db = firebase.database();
        console.log('Firebase initialized on window.load, db ready:', !!db);
      }
    }
  } catch (e) {
    console.warn('Firebase init on load failed:', e);
  }
});

/* ===== DBから来たピンをDOMに反映するヘルパー ===== */
function addPinFromData(key, data) {
  // 既に同一キーの要素があれば追加しない
  if (document.querySelector(`.pin[data-key=\"${key}\"]`)) return;

  const pin = document.createElement("div");
  pin.className = "pin";
  pin.style.left = `${data.x}px`;
  pin.style.top = `${data.y}px`;
  pin.style.backgroundColor = data.color;
  pin.dataset.color = data.color;
  pin.dataset.createdAt = data.createdAt || new Date().toISOString();
  pin.dataset.key = key;
  pin.dataset.createdBy = data.createdBy || 'unknown';

  pin.addEventListener("click", (event) => {
    event.stopPropagation();
    selectedPin = pin;

    const date = new Date(pin.dataset.createdAt);
    const formattedTime =
      `${date.getFullYear()}年` +
      `${date.getMonth() + 1}月` +
      `${date.getDate()}日 ` +
      `${date.getHours()}時` +
      `${date.getMinutes()}分` +
      `${date.getSeconds()}秒`;

    // 削除権の確認
    const canDelete = (pin.dataset.createdBy === sessionId);
    const deleteStatus = canDelete ? '（削除可）' : '（削除不可 - 他のユーザーが作成）';
    pinComment.textContent = `色：${pin.dataset.color} / 刺された時刻：${formattedTime} ${deleteStatus}`;

    // 削除ボタンの有効/無効を切り替え
    deleteButton.disabled = !canDelete;
    deleteButton.style.opacity = canDelete ? '1' : '0.5';
    deleteButton.style.cursor = canDelete ? 'pointer' : 'not-allowed';
    pinInfo.classList.remove("hidden");
  });

  wrapper.appendChild(pin);
}

/* ===== DB のイベントリスナをセット（存在する場合） ===== */
if (db) {
  const pinsRef = db.ref('pins');

  // 新しいピンが追加されたら反映
  pinsRef.on('child_added', (snapshot) => {
    const key = snapshot.key;
    const data = snapshot.val();
    addPinFromData(key, data);
  });

  // ピンが削除されたらDOMから削除
  pinsRef.on('child_removed', (snapshot) => {
    const key = snapshot.key;
    const el = document.querySelector(`.pin[data-key=\"${key}\"]`);
    if (el) el.remove();
    if (selectedPin && selectedPin.dataset.key === key) {
      selectedPin = null;
      pinInfo.classList.add('hidden');
    }
  });
}

/* ===== 画像クリックでピンを追加（ローカル or DBへ保存） ===== */
wrapper.addEventListener("click", (e) => {
  if (e.target.id !== "image") return;

  const rect = wrapper.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // 一時的にDOMに表示
  const pin = document.createElement("div");
  pin.className = "pin";
  pin.style.left = `${x}px`;
  pin.style.top = `${y}px`;
  pin.style.backgroundColor = currentColor;
  pin.dataset.color = currentColor;
  const createdAt = new Date();
  pin.dataset.createdAt = createdAt.toISOString();
  pin.dataset.createdBy = sessionId;

  pin.addEventListener("click", (event) => {
    event.stopPropagation();
    selectedPin = pin;

    const date = new Date(pin.dataset.createdAt);
    const formattedTime =
      `${date.getFullYear()}年` +
      `${date.getMonth() + 1}月` +
      `${date.getDate()}日 ` +
      `${date.getHours()}時` +
      `${date.getMinutes()}分` +
      `${date.getSeconds()}秒`;

    // 削除権の確認
    const canDelete = (pin.dataset.createdBy === sessionId);
    const deleteStatus = canDelete ? '（削除可）' : '（削除不可 - 他のユーザーが作成）';
    pinComment.textContent = `色：${pin.dataset.color} / 刺された時刻：${formattedTime} ${deleteStatus}`;

    // 削除ボタンの有効/無効を切り替え
    deleteButton.disabled = !canDelete;
    deleteButton.style.opacity = canDelete ? '1' : '0.5';
    deleteButton.style.cursor = canDelete ? 'pointer' : 'not-allowed';
    pinInfo.classList.remove("hidden");
  });

  wrapper.appendChild(pin);

  // ローカルのブラウザ内タイマーで30秒後にピンを画面から削除
  setTimeout(() => {
    if (pin.parentNode === wrapper) {
      pin.remove();
      console.log('Pin removed from DOM after 30s:', pin.dataset.key || 'local-pin');
    }
  }, 30000);

  // DBがある場合は保存（push）し、キーを割り当てる
  console.log('Attempting to save pin to DB? db=', !!db);
  if (db) {
    const pinsRef = db.ref('pins');
    const newRef = pinsRef.push();
    newRef.set({ x, y, color: currentColor, createdAt: pin.dataset.createdAt, createdBy: sessionId })
      .then(() => {
        // set dataset key so child_added handler won't duplicate
        pin.dataset.key = newRef.key;
        console.log('Pin saved to DB with key', newRef.key);
        
        // 30秒後に自動削除するタイマーをセット
        console.log('Setting auto-delete timer for key:', newRef.key);
        const timeoutId = setTimeout(() => {
          console.log('Auto-delete timer fired, attempting to remove:', newRef.key);
          db.ref(`pins/${newRef.key}`).remove()
            .then(() => console.log('Pin auto-deleted after 30s:', newRef.key))
            .catch((err) => console.error('Failed to auto-delete pin:', err));
        }, 30000);
        console.log('Timer set with ID:', timeoutId);
      })
      .catch((err) => console.error('Failed to save pin:', err));
  }
});

/* ===== 削除ボタンが押されたとき ===== */
deleteButton.addEventListener("click", () => {
  if (!selectedPin) return;

  // 削除権チェック
  if (selectedPin.dataset.createdBy !== sessionId) {
    alert('このピンは別のユーザーが作成したため、削除できません。');
    return;
  }

  const key = selectedPin.dataset.key;
  if (db && key) {
    db.ref(`pins/${key}`).remove().catch((err) => console.error('Failed to remove pin:', err));
  } else {
    selectedPin.remove();
  }

  selectedPin = null;
  pinInfo.classList.add("hidden");
});
