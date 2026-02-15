// 画像とピンを包む要素を取得
const wrapper = document.getElementById("image-wrapper");

// ピンを立てる対象画像
const imageEl = document.getElementById("image");

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

// Firebase Auth (anonymous) 参照
let auth = null;
let authUid = null;
let authReady = false;



// デバッグログ：スクリプト読み込み確認
console.log('script.js loaded - firebase defined?', typeof firebase !== 'undefined');

// セッションIDを生成（リロード後も同一ユーザー扱いにするため保存）
let sessionId = null;
try {
  sessionId = localStorage.getItem('pinSessionId');
} catch (e) {
  sessionId = null;
}
if (!sessionId) {
  sessionId = 'user-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now();
  try {
    localStorage.setItem('pinSessionId', sessionId);
  } catch (e) {
    // localStorage unavailable; fallback to in-memory sessionId
  }
}
console.log('Session ID:', sessionId);

const FADE_DURATION_MS = 60000;

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function scheduleFadeAndDelete(pinEl, createdAtIso, createdAtMs, key) {
  const createdAtTime = isFiniteNumber(createdAtMs) ? createdAtMs : new Date(createdAtIso).getTime();
  const now = Date.now();
  const elapsed = now - createdAtTime;
  const remaining = FADE_DURATION_MS - elapsed;

  if (remaining <= 0) {
    pinEl.style.opacity = "0";
    // Already faded/deleted via timeout or previous call - skip
    return;
  }

  const currentOpacity = Math.max(0, 1 - elapsed / FADE_DURATION_MS);
  pinEl.style.opacity = String(currentOpacity);
  pinEl.style.transition = `opacity ${remaining}ms linear`;

  requestAnimationFrame(() => {
    pinEl.style.opacity = "0";
  });

  setTimeout(() => {
    const currentAuthUid = authUid || sessionId;
    const createdByValue = pinEl.dataset.createdBy;
    const ownershipMatches = createdByValue === currentAuthUid;
    
    // Check if pin element still exists in DOM (not already deleted)
    const pinStillInDom = document.contains(pinEl);
    const pinInQuery = !!document.querySelector(`.pin[data-key="${key}"]`);
    
    if (!pinStillInDom) {
      console.log(`[Auto-Delete] Pin DOM element already removed, skipping deletion for key: ${key}`);
      return;
    }
    
    console.log(`[Auto-Delete Debug] Key: ${key}, Current Auth: ${currentAuthUid}, CreatedBy: ${createdByValue}, Ownership Match: ${ownershipMatches}`);
    
    if (db && key && ownershipMatches) {
      console.log(`[Auto-Delete] Proceeding with deletion for key: ${key}`);
      db.ref(`pins/${key}`).remove()
        .then(() => {
          console.log('Pin faded out & deleted after 60s:', key);
        })
        .catch((err) => {
          // Suppress error if pin is already gone from DOM
          if (!pinInQuery) {
            console.log(`[Auto-Delete] Pin already deleted/removed, ignoring error: ${err.code}`);
            return;
          }
          console.error('Failed to auto-delete pin:', err);
        });
    } else {
      console.log(`[Auto-Delete] Skipped deletion - condition failed. db=${!!db}, key=${!!key}, owned=${ownershipMatches}`);
    }
  }, remaining + 100);
}

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
    const appCheck = firebase.appCheck();
    appCheck.activate('6Ld1e2osAAAAAPWqPRjdPUyL34_6B9ChPI596OZy', true);
    db = firebase.database();
    auth = firebase.auth();
    auth.onAuthStateChanged((user) => {
      authUid = user ? user.uid : null;
      authReady = true;
    });
    auth.signInAnonymously().catch((err) => console.error('Anonymous sign-in failed:', err));
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
        const appCheck = firebase.appCheck();
        appCheck.activate('6Ld1e2osAAAAAPWqPRjdPUyL34_6B9ChPI596OZy', true);
        db = firebase.database();
        auth = firebase.auth();
        auth.onAuthStateChanged((user) => {
          authUid = user ? user.uid : null;
          authReady = true;
        });
        auth.signInAnonymously().catch((err) => console.error('Anonymous sign-in failed:', err));
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
  if (document.querySelector(`.pin[data-key=\"${key}\"]`)) {
    console.log(`[addPinFromData] Skipped duplicate key: ${key}`);
    return;
  }

  console.log(`[addPinFromData] Adding pin. Key: ${key}, CreatedBy: ${data.createdBy}, CreatedAtMs: ${data.createdAtMs}`);
  // 仮キーのピン（同じcreatedAtを持つ）があれば削除（DBキーに置き換わるため）
  const tempKey = 'temp-' + data.createdAt;
  const tempPin = document.querySelector(`.pin[data-key=\"${tempKey}\"]`);
  if (tempPin) {
    tempPin.remove();
    console.log('Removed temporary pin, replacing with DB pin:', key);
  }

  const pin = document.createElement("div");
  pin.className = "pin";
  const xPct = isFiniteNumber(data.xPct) ? data.xPct : null;
  const yPct = isFiniteNumber(data.yPct) ? data.yPct : null;
  if (xPct !== null && yPct !== null) {
    pin.style.left = `${xPct * 100}%`;
    pin.style.top = `${yPct * 100}%`;
  } else {
    pin.style.left = `${data.x}px`;
    pin.style.top = `${data.y}px`;
  }
  pin.style.backgroundColor = data.color;
  pin.dataset.color = data.color;
  const createdAtIso = data.createdAt || new Date().toISOString();
  const createdAtMs = isFiniteNumber(data.createdAtMs) ? data.createdAtMs : new Date(createdAtIso).getTime();
  pin.dataset.createdAt = createdAtIso;
  pin.dataset.createdAtMs = String(createdAtMs);
  pin.dataset.key = key;
  pin.dataset.createdBy = data.createdBy || 'unknown';
  if (xPct !== null && yPct !== null) {
    pin.dataset.xPct = String(xPct);
    pin.dataset.yPct = String(yPct);
  }

  // 生成時刻に合わせてフェード開始
  scheduleFadeAndDelete(pin, pin.dataset.createdAt, createdAtMs, key);


  pin.addEventListener("click", (event) => {
    event.stopPropagation();
    selectedPin = pin;

    const createdAtValue = pin.dataset.createdAtMs ? Number(pin.dataset.createdAtMs) : pin.dataset.createdAt;
    const date = new Date(createdAtValue);
    const formattedTime =
      `${date.getFullYear()}年` +
      `${date.getMonth() + 1}月` +
      `${date.getDate()}日 ` +
      `${date.getHours()}時` +
      `${date.getMinutes()}分` +
      `${date.getSeconds()}秒`;

    // 削除権の確認
    const canDelete = db ? (authUid && pin.dataset.createdBy === authUid) : (pin.dataset.createdBy === sessionId);
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

  if (db && (!authReady || !authUid)) {
    alert('認証の準備中です。少し待ってからもう一度お試しください。');
    return;
  }

  // セッションIDごとのピン数制限チェック（1人当たり5個）
  // DBに実際に保存されたピン（DB キーを持つ、仮キー除外）だけをカウント
  const ownerId = db ? authUid : sessionId;
  const allUserPins = ownerId ? wrapper.querySelectorAll(`.pin[data-created-by="${ownerId}"][data-key]`) : [];
  const userPins = Array.from(allUserPins).filter(pin => !pin.dataset.key.startsWith('temp-'));
  console.log('=== ピン数カウント ===');
  console.log('sessionId:', sessionId);
  console.log('DBに保存されたピン数:', userPins.length);
  userPins.forEach((pin, index) => {
    console.log(`  ${index + 1}. key=${pin.dataset.key}, color=${pin.dataset.color}`);
  });
  
  // すべてのピンも確認
  const allPins = wrapper.querySelectorAll(`.pin`);
  console.log('DOMに存在するすべてのピン数:', allPins.length);
  
  if (userPins.length >= 5) {
    alert('このセッションではピンを5個まで立てられます。古いピンが自動削除されるまで待つか、手動で削除してください。');
    return;
  }

  // 同じ色のピンがすでに存在するかチェック
  const sameColorPin = userPins.find(pin => pin.dataset.color === currentColor);
  if (sameColorPin) {
    alert('この色のピンはすでに配置されています。同じ色のピンは1つまでです。');
    return;
  }

  const rect = imageEl.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const xPct = clamp01(x / rect.width);
  const yPct = clamp01(y / rect.height);

  // 一時的にDOMに表示
  const pin = document.createElement("div");
  pin.className = "pin";
  pin.style.left = `${xPct * 100}%`;
  pin.style.top = `${yPct * 100}%`;
  pin.style.backgroundColor = currentColor;
  pin.dataset.color = currentColor;
  const createdAt = new Date();
  const createdAtIso = createdAt.toISOString();
  const createdAtMs = Date.now();
  pin.dataset.createdAt = createdAtIso;
  pin.dataset.createdAtMs = String(createdAtMs);
  pin.dataset.createdBy = ownerId || sessionId;
  pin.dataset.xPct = String(xPct);
  pin.dataset.yPct = String(yPct);

  pin.addEventListener("click", (event) => {
    event.stopPropagation();
    selectedPin = pin;

    const createdAtValue = pin.dataset.createdAtMs ? Number(pin.dataset.createdAtMs) : pin.dataset.createdAt;
    const date = new Date(createdAtValue);
    const formattedTime =
      `${date.getFullYear()}年` +
      `${date.getMonth() + 1}月` +
      `${date.getDate()}日 ` +
      `${date.getHours()}時` +
      `${date.getMinutes()}分` +
      `${date.getSeconds()}秒`;

    // 削除権の確認
    const canDelete = db ? (authUid && pin.dataset.createdBy === authUid) : (pin.dataset.createdBy === sessionId);
    const deleteStatus = canDelete ? '（削除可）' : '（削除不可 - 他のユーザーが作成）';
    pinComment.textContent = `色：${pin.dataset.color} / 刺された時刻：${formattedTime} ${deleteStatus}`;

    // 削除ボタンの有効/無効を切り替え
    deleteButton.disabled = !canDelete;
    deleteButton.style.opacity = canDelete ? '1' : '0.5';
    deleteButton.style.cursor = canDelete ? 'pointer' : 'not-allowed';
    pinInfo.classList.remove("hidden");
  });

  // 仮のキーを付与してローカルのピンを識別（重複防止）
  const tempKey = 'temp-' + pin.dataset.createdAt;
  pin.dataset.key = tempKey;

  wrapper.appendChild(pin);

  // DBがある場合は保存（push）し、キーを割り当てる
  console.log('Attempting to save pin to DB? db=', !!db);
  if (db) {
    if (!authReady || !authUid) {
      console.warn('Auth not ready; pin not saved yet.');
      return;
    }
    const pinsRef = db.ref('pins');
    const newRef = pinsRef.push();
    newRef.set({
      xPct,
      yPct,
      x,
      y,
      color: currentColor,
      createdAt: createdAtIso,
      createdAtMs: createdAtMs,
      createdBy: authUid
    })
      .then(() => {
        // 仮のキーを実際のDBキーに置き換え
        pin.dataset.key = newRef.key;
        console.log('Pin saved to DB with key', newRef.key);
        
        // ログにも保存（日付別）
        const logDate = new Date(createdAtMs).toISOString().split('T')[0]; // YYYY-MM-DD
        db.ref(`pin_logs/${logDate}/${newRef.key}`).set({
          xPct,
          yPct,
          x,
          y,
          color: currentColor,
          createdAt: createdAtIso,
          createdAtMs: createdAtMs,
          createdBy: authUid
        }).catch(err => console.warn('Failed to save pin log:', err));
        
        // 30秒後に自動削除するタイマーをセット
        //console.log('Setting auto-delete timer for key:', newRef.key);
        //const timeoutId = setTimeout(() => {
        //  console.log('Auto-delete timer fired, attempting to remove:', newRef.key);
        //  db.ref(`pins/${newRef.key}`).remove()
        //    .then(() => console.log('Pin auto-deleted after 30s:', newRef.key))
        //    .catch((err) => console.error('Failed to auto-delete pin:', err));
        //}, 30000);
        
        // フェード開始と自動削除を統一
        const fadeEl = document.querySelector(`.pin[data-key="${newRef.key}"]`);
        if (fadeEl) {
          scheduleFadeAndDelete(fadeEl, pin.dataset.createdAt, createdAtMs, newRef.key);
        }
      })
      .catch((err) => console.error('Failed to save pin:', err));
    }
  });

/* ===== 削除ボタンが押されたとき ===== */
deleteButton.addEventListener("click", () => {
  if (!selectedPin) return;

  // 削除権チェック
  if (db) {
    if (!authUid || selectedPin.dataset.createdBy !== authUid) {
      alert('このピンは別のユーザーが作成したため、削除できません。');
      return;
    }
  } else if (selectedPin.dataset.createdBy !== sessionId) {
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

/* ===== 今日のログを画像としてエクスポート ===== */
const exportButton = document.getElementById('export-today-logs');
if (exportButton) {
  exportButton.addEventListener('click', async () => {
    if (!db) {
      alert('Firebase が初期化されていません。ログ機能を使用するにはFirebase設定が必要です。');
      return;
    }

    exportButton.disabled = true;
    exportButton.textContent = 'ログを取得中...';

    try {
      // 今日の日付を取得
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      console.log(`Fetching logs for date: ${today}`);

      // ログデータを取得
      const logsSnapshot = await db.ref(`pin_logs/${today}`).once('value');
      const logsData = logsSnapshot.val();

      if (!logsData || Object.keys(logsData).length === 0) {
        alert(`${today} のログがありません。`);
        exportButton.disabled = false;
        exportButton.textContent = '今日のログを画像として保存';
        return;
      }

      console.log(`Found ${Object.keys(logsData).length} logs for today`);
      exportButton.textContent = `${Object.keys(logsData).length}個のピンを画像化中...`;

      // 現在のピンを一時的に非表示にして復元用に保存
      const currentPins = wrapper.querySelectorAll('.pin');
      const pinVisibility = Array.from(currentPins).map(pin => ({
        element: pin,
        display: pin.style.display
      }));
      currentPins.forEach(pin => pin.style.display = 'none');

      // ログからピンを一時的に作成
      const tempPins = [];
      Object.entries(logsData).forEach(([key, data]) => {
        const pin = document.createElement("div");
        pin.className = "pin temp-export-pin";
        const xPct = isFiniteNumber(data.xPct) ? data.xPct : null;
        const yPct = isFiniteNumber(data.yPct) ? data.yPct : null;

        if (xPct !== null && yPct !== null) {
          pin.style.left = `${xPct * 100}%`;
          pin.style.top = `${yPct * 100}%`;
        }
        pin.style.backgroundColor = data.color;
        pin.style.opacity = '1'; // 完全に表示
        wrapper.appendChild(pin);
        tempPins.push(pin);
      });

      // 少し待ってDOMを安定させる
      await new Promise(resolve => setTimeout(resolve, 100));

      // html2canvasで画像化
      const canvas = await html2canvas(wrapper, {
        backgroundColor: '#ffffff',
        scale: 2, // 高解像度
        logging: false
      });

      // 一時ピンを削除
      tempPins.forEach(pin => pin.remove());

      // 元のピンの表示を復元
      pinVisibility.forEach(({element, display}) => {
        element.style.display = display;
      });

      // 画像をダウンロード
      const link = document.createElement('a');
      link.download = `moomin-map-log-${today}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();

      exportButton.textContent = '今日のログを画像として保存';
      exportButton.disabled = false;
      console.log('Export completed successfully');

    } catch (error) {
      console.error('Export failed:', error);
      alert(`画像のエクスポートに失敗しました: ${error.message}`);
      exportButton.textContent = '今日のログを画像として保存';
      exportButton.disabled = false;

      // エラー時も元の表示を復元
      const allTempPins = wrapper.querySelectorAll('.temp-export-pin');
      allTempPins.forEach(pin => pin.remove());
      const currentPins = wrapper.querySelectorAll('.pin');
      currentPins.forEach(pin => pin.style.display = '');
    }
  });
}
