import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getDatabase, ref, onValue, get, set, update, push, runTransaction, remove, off } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';

const firebaseConfig = {
  apiKey: 'AIzaSyA-Y_qYftzPYHh9hCXUM7bMqK7j5pMVbzc',
  authDomain: 'quiz-bad1f.firebaseapp.com',
  databaseURL: 'https://quiz-bad1f-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'quiz-bad1f',
  storageBucket: 'quiz-bad1f.firebasestorage.app',
  messagingSenderId: '443723924249',
  appId: '1:443723924249:web:1ef489b7cef75a7c143b88'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

const $ = id => document.getElementById(id);
const els = {
  joinView: $('joinView'), hostLobbyView: $('hostLobbyView'), hostRoundView: $('hostRoundView'), hostResultsView: $('hostResultsView'),
  hostFinalView: $('hostFinalView'), playerWaitingView: $('playerWaitingView'), playerReadyView: $('playerReadyView'),
  playerRoundView: $('playerRoundView'), playerHoldView: $('playerHoldView'), playerRejectedView: $('playerRejectedView'), loadingView: $('loadingView'),
  teamName: $('teamName'), roomCode: $('roomCode'), joinBtn: $('joinBtn'), randomBtn: $('randomBtn'), localRole: $('localRole'), roomInfo: $('roomInfo'),
  pendingTeams: $('pendingTeams'), acceptedTeams: $('acceptedTeams'), startGameBtn: $('startGameBtn'), stopRoundBtn: $('stopRoundBtn'), hostCodeBars: document.querySelectorAll('.hostCodeBar'),
  answersList: $('answersList'), nextRoundBtn: $('nextRoundBtn'), endGameBtn: $('endGameBtn'), finalRanking: $('finalRanking'),
  newRoomBtn: $('newRoomBtn'), waitingText: $('waitingText'), answerInput: $('answerInput'), submitAnswerBtn: $('submitAnswerBtn'),
  submitState: $('submitState'),
  timedSeconds: $('timedSeconds'), timedStartBtn: $('timedStartBtn'),
  nextTimedSeconds: $('nextTimedSeconds'), nextTimedStartBtn: $('nextTimedStartBtn'),
  countdown: $('countdown')
};

const joinHintEl = document.querySelector('#joinView .hint');
const defaultJoinHint = joinHintEl ? joinHintEl.textContent : '';

const state = {
  clientId: getOrCreateClientId(),
  roomCode: localStorage.getItem('quiz_roomCode') || '',
  teamId: localStorage.getItem('quiz_teamId') || '',
  role: localStorage.getItem('quiz_role') || '',
  unsubscribe: null,
  roomData: null,
  authReady: false,
  authUid: '',
  authError: '',
  finishedSnapshot: null,
  countdownInterval: null,
  stoppingRound: false
};

if (state.roomCode) els.roomCode.value = state.roomCode;

els.randomBtn.addEventListener('click', () => { els.roomCode.value = randomCode(); });
els.joinBtn.addEventListener('click', joinOrCreateRoom);
els.startGameBtn.addEventListener('click', () => startRound(null));
els.timedStartBtn.addEventListener('click', () => startRound(readSeconds(els.timedSeconds)));
els.nextRoundBtn.addEventListener('click', () => startRound(null));
els.nextTimedStartBtn.addEventListener('click', () => startRound(readSeconds(els.nextTimedSeconds)));
els.stopRoundBtn.addEventListener('click', () => stopRound('manual'));
els.endGameBtn.addEventListener('click', endGame);
const endGameBtnResults = document.getElementById('endGameBtnResults');
if (endGameBtnResults) endGameBtnResults.addEventListener('click', endGame);
els.newRoomBtn.addEventListener('click', () => resetLocalState(true));
els.submitAnswerBtn.addEventListener('click', submitAnswer);

bootAuth();
showOnly('loadingView');

function getOrCreateClientId() {
  let id = localStorage.getItem('quiz_clientId');
  if (!id) {
    id = 'c_' + crypto.randomUUID();
    localStorage.setItem('quiz_clientId', id);
  }
  return id;
}

function randomCode() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

function sanitizeCode(value) {
  return (value || '').replace(/\D/g, '').slice(0, 5);
}

function sanitizeName(value) {
  return (value || '').trim().slice(0, 40);
}

function readSeconds(inputEl) {
  const raw = (inputEl?.value || '').toString().trim();
  if (!raw) return null;

  const norm = raw.replace(/\s+/g, '').replace(',', '.');
  if (/^\d+$/.test(norm)) {
    const sec = Number(norm);
    return Number.isFinite(sec) && sec > 0 ? Math.round(sec) : null;
  }

  const mmss = norm.match(/^(\d{1,3}):(\d{1,2})$/);
  if (mmss) {
    const minutes = Number(mmss[1]);
    const seconds = Number(mmss[2]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds > 59) return null;
    return minutes * 60 + seconds;
  }

  const num = Number(norm);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num);
}

function bootAuth() {
  onAuthStateChanged(auth, user => {
    state.authReady = !!user;
    state.authUid = user?.uid || '';
    if (user) state.authError = '';
    if (state.roomCode && user) subscribeRoom(state.roomCode);
    render();
  });

  signInAnonymously(auth).catch(error => {
    console.error('Anonymous auth failed:', error);
    state.authReady = false;
    state.authError = readableError(error);
    render();
  });
}

async function joinOrCreateRoom() {
  if (!ensureAuthReady()) return;

  const roomCode = sanitizeCode(els.roomCode.value);
  const teamName = sanitizeName(els.teamName.value);
  if (roomCode.length !== 5) {
    alert('Zadej pětimístný kód místnosti.');
    return;
  }
  if (!teamName) {
    alert('Zadej jméno týmu.');
    return;
  }

  state.finishedSnapshot = null;
  state.authError = '';
  state.role = '';
  state.teamId = '';
  localStorage.removeItem('quiz_teamId');
  localStorage.removeItem('quiz_role');
  setLoading('Připojování k místnosti…');

  const roomRef = ref(db, `rooms/${roomCode}`);
  let roomData = null;

  try {
    const roomSnap = await get(roomRef);
    roomData = roomSnap.val();
  } catch (error) {
    console.error('Room read failed:', error);
    state.authError = readableError(error);
    alert('Nepodařilo se připojit k místnosti. Zkus stránku obnovit a znovu.');
    render();
    return;
  }

  if (!roomData) {
    let tx;
    try {
      tx = await runTransaction(roomRef, current => {
        if (current !== null) return current;
        return {
          code: roomCode,
          createdAt: Date.now(),
          hostClientId: state.clientId,
          hostUid: state.authUid,
          hostName: teamName,
          status: 'lobby',
          currentRound: 0,
          roundStartedAt: null,
          roundStoppedAt: null,
          roundTimeLimitSec: null,
          roundDeadlineAt: null,
          lastActionAt: Date.now(),
          teams: {},
          rounds: {},
          roundScoreDelta: {}
        };
      }, { applyLocally: false });
    } catch (error) {
      console.error('Transaction failed:', error);
      state.authError = readableError(error);
      alert('Nepodařilo se připojit k místnosti. Zkus stránku obnovit a znovu.');
      render();
      return;
    }

    if (!tx.committed || !tx.snapshot.exists()) {
      alert('Nepodařilo se vytvořit nebo načíst místnost.');
      render();
      return;
    }
    roomData = tx.snapshot.val() || {};
  }

  const iAmHost = roomData.hostClientId === state.clientId;

  state.roomCode = roomCode;
  localStorage.setItem('quiz_roomCode', roomCode);
  subscribeRoom(roomCode);

  if (iAmHost) {
    state.role = 'host';
    localStorage.setItem('quiz_role', 'host');
    render();
    return;
  }

  state.role = 'player';
  localStorage.setItem('quiz_role', 'player');

  const teamsRef = ref(db, `rooms/${roomCode}/teams`);
  try {
    const existingTeams = (await get(teamsRef)).val() || {};
    const found = Object.entries(existingTeams).find(([, team]) => team && team.clientId === state.clientId);

    if (found) {
      state.teamId = found[0];
      const patch = { uid: state.authUid, lastJoinAt: Date.now() };
      if ((found[1]?.name || '') !== teamName) patch.name = teamName;
      if (found[1]?.status === 'rejected') patch.status = 'pending';
      await update(ref(db, `rooms/${roomCode}/teams/${state.teamId}`), patch);
    } else {
      const newTeamRef = push(teamsRef);
      state.teamId = newTeamRef.key;
      await set(newTeamRef, {
        clientId: state.clientId,
        uid: state.authUid,
        name: teamName,
        status: 'pending',
        score: 0,
        joinedAt: Date.now(),
        lastJoinAt: Date.now()
      });
    }
  } catch (error) {
    console.error('Join team failed:', error);
    state.authError = readableError(error);
    alert('Nepodařilo se připojit k místnosti. Zkus stránku obnovit a znovu.');
    render();
    return;
  }

  localStorage.setItem('quiz_teamId', state.teamId);
  render();
}

function subscribeRoom(roomCode) {
  if (!state.authReady) return;
  if (state.unsubscribe) state.unsubscribe();

  const roomRef = ref(db, `rooms/${roomCode}`);
  const callback = snapshot => {
    state.roomData = snapshot.val();

    if (!state.roomData) {
      clearCountdownTicker();
      const finishedData = state.finishedSnapshot;
      const wasHost = state.role === 'host';
      resetLocalState(false);
      if (finishedData && wasHost) {
        state.finishedSnapshot = finishedData;
        showOnly('hostFinalView');
        renderFinalRanking(finishedData);
      } else {
        render();
        alert('Hra skončila. Místnost byla smazána.');
      }
      return;
    }

    if (state.roomData.hostClientId === state.clientId) {
      state.role = 'host';
      localStorage.setItem('quiz_role', 'host');
      localStorage.removeItem('quiz_teamId');
      if (state.roomData.status === 'round_active') maybeAutoStopRound();
    } else if (state.teamId) {
      state.role = 'player';
      localStorage.setItem('quiz_role', 'player');
    }
    render();
  };

  onValue(roomRef, callback, error => {
    console.error('Room subscription failed:', error);
    state.authError = readableError(error);
    render();
  });

  state.unsubscribe = () => off(roomRef, 'value', callback);
}

function showOnly(viewId) {
  Object.values(els).forEach(el => {
    if (el instanceof HTMLElement && el.id && el.id.endsWith('View')) el.classList.add('hidden');
  });
  if (els[viewId]) els[viewId].classList.remove('hidden');
}

function setLoading(message = 'Načítání…') {
  showOnly('loadingView');
  const title = els.loadingView.querySelector('h2, div');
  if (title) title.textContent = message;
}

function render() {
  els.localRole.textContent = roleLabel();
  els.roomInfo.textContent = `Místnost: ${state.roomCode || '—'}`;
  els.hostCodeBars.forEach(el => { el.textContent = state.roomCode ? `Kód místnosti: ${state.roomCode}` : 'Kód místnosti: —'; });
  if (joinHintEl) joinHintEl.textContent = defaultJoinHint;

  if (state.finishedSnapshot && !state.roomData && state.role !== 'player') {
    showOnly('hostFinalView');
    renderFinalRanking(state.finishedSnapshot);
    return;
  }

  if (state.authError) {
    showOnly('joinView');
    if (joinHintEl) joinHintEl.textContent = `Chyba Firebase: ${state.authError}`;
    return;
  }

  if (!state.authReady) {
    setLoading('Přihlašování do Firebase…');
    return;
  }

  if (!state.roomData) {
    clearCountdownTicker();
    showOnly('joinView');
    return;
  }

  const roomHostClientId = state.roomData.hostClientId || '';
  if (roomHostClientId === state.clientId) {
    state.role = 'host';
    localStorage.setItem('quiz_role', 'host');
  } else if (state.teamId) {
    state.role = 'player';
    localStorage.setItem('quiz_role', 'player');
  }

  if (state.role === 'host') renderHost();
  else renderPlayer();
}

function roleLabel() {
  if (state.role === 'host') return 'Host';
  if (state.role === 'player') return 'Tým';
  return state.authReady ? 'Nepřipojeno' : 'Přihlašování';
}

function renderHost() {
  const room = state.roomData;
  const teams = room.teams || {};
  const pending = Object.entries(teams).filter(([, t]) => t.status === 'pending');
  const accepted = Object.entries(teams).filter(([, t]) => t.status === 'accepted');

  renderPendingList(pending);
  renderAcceptedList(accepted);

  if (room.status === 'lobby') {
    clearCountdownTicker();
    showOnly('hostLobbyView');
    els.startGameBtn.disabled = accepted.length === 0;
    els.timedStartBtn.disabled = accepted.length === 0;
  } else if (room.status === 'round_active') {
    showOnly('hostRoundView');
    syncHostCountdown();
    maybeAutoStopRound();
  } else if (room.status === 'round_stopped') {
    clearCountdownTicker();
    showOnly('hostResultsView');
    renderAnswers();
    els.nextRoundBtn.disabled = accepted.length === 0;
    els.nextTimedStartBtn.disabled = accepted.length === 0;
  } else if (room.status === 'finished') {
    clearCountdownTicker();
    showOnly('hostFinalView');
    renderFinalRanking(room);
  } else {
    clearCountdownTicker();
    showOnly('hostLobbyView');
  }
}

function renderPendingList(pending) {
  els.pendingTeams.innerHTML = '';
  if (!pending.length) {
    els.pendingTeams.innerHTML = '<div class="empty">Nikdo momentálně nečeká.</div>';
    return;
  }

  for (const [teamId, team] of pending.sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0))) {
    const row = document.createElement('div');
    row.className = 'teamRow';
    row.innerHTML = `
      <div class="teamName">${escapeHtml(team.name || 'Bez názvu')}</div>
      <div class="teamActions">
        <button data-team="${teamId}" data-action="accept">Přijmout</button>
        <button class="secondary" data-team="${teamId}" data-action="reject">Odmítnout</button>
      </div>`;

    row.querySelectorAll('button').forEach(btn => btn.addEventListener('click', async e => {
      const action = e.currentTarget.dataset.action;
      await update(ref(db, `rooms/${state.roomCode}/teams/${teamId}`), {
        status: action === 'accept' ? 'accepted' : 'rejected'
      });
    }));

    els.pendingTeams.appendChild(row);
  }
}

function renderAcceptedList(accepted) {
  els.acceptedTeams.innerHTML = '';
  if (!accepted.length) return;

  for (const [, team] of accepted.sort((a, b) => (b[1].score || 0) - (a[1].score || 0) || (a[1].joinedAt || 0) - (b[1].joinedAt || 0))) {
    const row = document.createElement('div');
    row.className = 'teamRow acceptedRow';
    row.innerHTML = `
      <div class="acceptedName">${escapeHtml(team.name || 'Bez názvu')}</div>
      <div class="acceptedScore">${team.score || 0}</div>`;
    els.acceptedTeams.appendChild(row);
  }
}

function getMyTeam() {
  const teams = state.roomData?.teams || {};
  return state.teamId ? teams[state.teamId] : null;
}

function renderPlayer() {
  clearCountdownTicker();
  const room = state.roomData;
  const myTeam = getMyTeam();
  if (!myTeam) {
    showOnly('joinView');
    return;
  }

  if (myTeam.status === 'pending') {
    showOnly('playerWaitingView');
    els.waitingText.textContent = 'Počkejte na zahájení soutěže.';
    return;
  }
  if (myTeam.status === 'rejected') {
    showOnly('playerRejectedView');
    return;
  }
  if (room.status === 'lobby') {
    showOnly('playerReadyView');
    return;
  }
  if (room.status === 'round_active') {
    showOnly('playerRoundView');
    const answer = currentAnswer();
    if (answer) {
      els.answerInput.value = answer.answer || '';
      els.answerInput.disabled = true;
      els.submitAnswerBtn.disabled = true;
      els.submitState.textContent = 'Odpověď odeslána.';
    } else {
      els.answerInput.value = '';
      els.answerInput.disabled = false;
      els.submitAnswerBtn.disabled = false;
      els.submitState.textContent = '';
    }
    return;
  }
  if (room.status === 'round_stopped' || room.status === 'finished') {
    showOnly('playerHoldView');
    return;
  }
  showOnly('playerReadyView');
}

function currentAnswer() {
  const room = state.roomData;
  if (!room || !state.teamId) return null;
  return room.rounds?.[room.currentRound]?.[state.teamId] || null;
}

async function startRound(limitSec = null) {
  if (!ensureAuthReady()) return;
  const accepted = Object.entries(state.roomData?.teams || {}).filter(([, t]) => t.status === 'accepted');
  if (!accepted.length) {
    alert('Nejdřív přijmi alespoň jeden tým.');
    return;
  }

  if (limitSec !== null && (!Number.isFinite(limitSec) || limitSec <= 0)) {
    alert('Zadej čas kola. Můžeš napsat třeba 90 nebo 2:30.');
    return;
  }

  const nextRound = (state.roomData.currentRound || 0) + 1;
  const startedAt = Date.now();
  const patch = {
    status: 'round_active',
    currentRound: nextRound,
    roundStartedAt: startedAt,
    roundStoppedAt: null,
    roundStopReason: null,
    roundTimeLimitSec: limitSec || null,
    roundDeadlineAt: limitSec ? startedAt + limitSec * 1000 : null,
    roundExpectedAnswers: accepted.length,
    lastActionAt: startedAt
  };

  try {
    await update(ref(db, `rooms/${state.roomCode}`), patch);
  } catch (error) {
    console.error('Start round failed:', error);
    alert('Kolo se nepodařilo spustit.');
  }
}

async function stopRound(reason = 'manual') {
  if (!ensureAuthReady() || state.stoppingRound) return;
  if (!state.roomData || state.roomData.status !== 'round_active') return;

  state.stoppingRound = true;
  const now = Date.now();
  try {
    await update(ref(db, `rooms/${state.roomCode}`), {
      status: 'round_stopped',
      roundStoppedAt: now,
      roundStopReason: reason,
      roundDeadlineAt: null,
      lastActionAt: now
    });
  } catch (error) {
    console.error('Stop round failed:', error);
    alert('Kolo se nepodařilo ukončit.');
  } finally {
    setTimeout(() => { state.stoppingRound = false; }, 300);
  }
}

function formatCountdown(totalSeconds) {
  const sec = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function syncHostCountdown() {
  const room = state.roomData;
  const deadline = Number(room?.roundDeadlineAt || 0);
  if (!deadline) {
    els.countdown.textContent = '';
    clearCountdownTicker();
    return;
  }

  const tick = () => {
    const leftMs = Math.max(0, deadline - Date.now());
    const sec = leftMs / 1000;
    els.countdown.textContent = formatCountdown(sec);
    if (leftMs <= 0) stopRound('timer');
  };

  tick();
  if (state.countdownInterval) return;
  state.countdownInterval = setInterval(tick, 250);
}

function clearCountdownTicker() {
  if (state.countdownInterval) {
    clearInterval(state.countdownInterval);
    state.countdownInterval = null;
  }
  if (els.countdown) els.countdown.textContent = '';
}

function maybeAutoStopRound() {
  const room = state.roomData;
  if (!room || room.status !== 'round_active') return;

  if (room.roundDeadlineAt && Date.now() >= Number(room.roundDeadlineAt)) {
    stopRound('timer');
    return;
  }

  const acceptedIds = Object.entries(room.teams || {})
    .filter(([, team]) => team.status === 'accepted')
    .map(([teamId]) => teamId);
  if (!acceptedIds.length) return;

  const roundAnswers = room.rounds?.[room.currentRound] || {};
  const allAnswered = acceptedIds.every(teamId => !!roundAnswers[teamId]);
  if (allAnswered) stopRound('all_answered');
}

async function endGame() {
  if (!ensureAuthReady()) return;
  const finalRoom = structuredClone(state.roomData || {});
  finalRoom.status = 'finished';
  state.finishedSnapshot = finalRoom;
  showOnly('hostFinalView');
  renderFinalRanking(finalRoom);

  try {
    await remove(ref(db, `rooms/${state.roomCode}`));
  } catch (error) {
    console.error('Failed to delete room:', error);
    alert('Nepodařilo se smazat místnost ve Firebase.');
  }
}

async function submitAnswer() {
  if (!ensureAuthReady()) return;
  const room = state.roomData;
  const myTeam = getMyTeam();
  if (!room || !myTeam || myTeam.status !== 'accepted' || room.status !== 'round_active') return;

  const answer = els.answerInput.value.trim().slice(0, 300);
  if (!answer) {
    alert('Napište odpověď.');
    return;
  }

  const answerRef = ref(db, `rooms/${state.roomCode}/rounds/${room.currentRound}/${state.teamId}`);
  const existing = await get(answerRef);
  if (existing.exists()) return;

  const now = Date.now();
  try {
    await set(answerRef, {
      teamId: state.teamId,
      teamUid: state.authUid,
      teamName: myTeam.name,
      answer,
      submittedAt: now,
      elapsedMs: Math.max(0, now - (room.roundStartedAt || now))
    });
  } catch (error) {
    console.error('Submit answer failed:', error);
    alert('Odpověď se nepodařilo odeslat.');
    return;
  }

  els.answerInput.disabled = true;
  els.submitAnswerBtn.disabled = true;
  els.submitState.textContent = 'Odpověď odeslána.';

  if (state.role === 'host') maybeAutoStopRound();
}

function renderAnswers() {
  const room = state.roomData;
  const teams = room.teams || {};
  const round = room.currentRound;
  const roundDelta = room.roundScoreDelta?.[round] || {};
  const answers = Object.entries(room.rounds?.[round] || {}).map(([teamId, val]) => ({
    teamId,
    name: teams[teamId]?.name || val.teamName || 'Bez názvu',
    score: teams[teamId]?.score || 0,
    answer: val.answer || '',
    roundDelta: Number(roundDelta[teamId] || 0),
    elapsedMs: val.elapsedMs ?? 999999999,
    submittedAt: val.submittedAt || 0
  })).sort((a, b) => (a.elapsedMs - b.elapsedMs) || (a.submittedAt - b.submittedAt));

  const missing = Object.entries(teams)
    .filter(([, t]) => t.status === 'accepted')
    .filter(([teamId]) => !answers.some(a => a.teamId === teamId))
    .map(([teamId, t]) => ({
      teamId,
      name: t.name,
      score: t.score || 0,
      answer: 'Neodesláno',
      roundDelta: Number(roundDelta[teamId] || 0),
      elapsedMs: null
    }));

  const all = [...answers, ...missing];
  els.answersList.innerHTML = '';
  if (!all.length) {
    els.answersList.innerHTML = '<div class="empty">V tomto kole zatím není žádná odpověď.</div>';
    return;
  }

  const header = document.createElement('div');
  header.className = 'tableHeader';
  header.innerHTML = '<div>Tým</div><div>Odpověď</div><div>Body</div><div></div>';
  els.answersList.appendChild(header);

  for (const item of all) {
    const row = document.createElement('div');
    row.className = 'answerRow';
    if (item.roundDelta > 0) row.classList.add('row-positive');
    if (item.roundDelta < 0) row.classList.add('row-negative');
row.innerHTML = `
  <div class="answerName">${escapeHtml(item.name)}</div>
  <div class="answerAnswer">${escapeHtml(item.answer)}</div>
  <div class="answerScore clickableScore" data-team="${item.teamId}">${item.score}</div>
  <div class="pmBox">
    <button class="iconBtn plus" data-team="${item.teamId}" data-delta="1">+</button>
    <button class="iconBtn minus" data-team="${item.teamId}" data-delta="-1">−</button>
  </div>`;
    
    row.querySelectorAll('button').forEach(btn => btn.addEventListener('click', async e => {
      const teamId = e.currentTarget.dataset.team;
      const delta = Number(e.currentTarget.dataset.delta || 0);
      await adjustScore(teamId, delta);
    }));
    const scoreEl = row.querySelector('.clickableScore');
scoreEl.addEventListener('click', async () => {
  const teamId = scoreEl.dataset.team;
  const input = prompt('Počet získaných / ztracených bodů:');

  if (input === null) return;

  const delta = Number(input);
  if (!Number.isFinite(delta)) {
    alert('Zadej číslo (např. 350 nebo -350)');
    return;
  }

  await adjustScore(teamId, delta);
});
    els.answersList.appendChild(row);
  }
}

async function adjustScore(teamId, delta) {
  const round = state.roomData?.currentRound;
  const teamScoreRef = ref(db, `rooms/${state.roomCode}/teams/${teamId}/score`);
  const roundDeltaRef = ref(db, `rooms/${state.roomCode}/roundScoreDelta/${round}/${teamId}`);
  await Promise.all([
    runTransaction(teamScoreRef, current => Number(current || 0) + delta),
    runTransaction(roundDeltaRef, current => Number(current || 0) + delta)
  ]);
}

function finalRankingData(roomArg = null) {
  const teams = roomArg?.teams || state.roomData?.teams || {};
  return Object.entries(teams)
    .filter(([, t]) => t.status === 'accepted')
    .map(([teamId, t]) => ({ teamId, name: t.name || 'Bez názvu', score: t.score || 0, joinedAt: t.joinedAt || 0 }))
    .sort((a, b) => (b.score - a.score) || (a.joinedAt - b.joinedAt));
}

function renderFinalRanking(roomArg = null) {
  const data = finalRankingData(roomArg);
  els.finalRanking.innerHTML = '';
  if (!data.length) {
    els.finalRanking.innerHTML = '<div class="empty">Žádné přijaté týmy.</div>';
    return;
  }

  data.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'rankRow';
    row.innerHTML = `
      <div class="place">${i + 1}.</div>
      <div>
        <div class="teamName">${escapeHtml(item.name)}</div>
      </div>
      <div class="answerScore">${item.score}</div>`;
    els.finalRanking.appendChild(row);
  });
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function ensureAuthReady() {
  if (state.authReady && auth.currentUser) return true;
  alert('Firebase ještě není přihlášený. Obnov stránku a zkus to znovu.');
  return false;
}

function readableError(error) {
  return error?.code || error?.message || 'neznámá chyba';
}

function resetLocalState(reload = true) {
  clearCountdownTicker();
  if (state.unsubscribe) state.unsubscribe();
  state.unsubscribe = null;
  localStorage.removeItem('quiz_roomCode');
  localStorage.removeItem('quiz_role');
  localStorage.removeItem('quiz_teamId');
  state.roomCode = '';
  state.teamId = '';
  state.role = '';
  state.roomData = null;
  if (reload) location.reload();
}

// ===== PREZENTACE =====

let pdfDoc = null;
let currentSlide = 1;
let totalSlides = 1;
let fileType = null;

const canvas = document.getElementById("pdfCanvas");
const ctx = canvas ? canvas.getContext("2d") : null;
const pptContainer = document.getElementById("pptContainer");
const slideInfo = document.getElementById("slideInfo");

const uploadBtn = document.getElementById("uploadPresentationBtn");
const fileInput = document.getElementById("presentationFile");

if (uploadBtn) {

  uploadBtn.onclick = () => fileInput.click();

  fileInput.onchange = async e => {

    const file = e.target.files[0];
    if (!file) return;

    const url = URL.createObjectURL(file);

    if (file.name.endsWith(".pdf")) {

      fileType = "pdf";

      pptContainer.innerHTML = "";
      canvas.style.display = "block";

      const loadingTask = pdfjsLib.getDocument(url);
      pdfDoc = await loadingTask.promise;

      totalSlides = pdfDoc.numPages;
      currentSlide = 1;

      renderPdf();

    }

    if (file.name.endsWith(".pptx")) {

      fileType = "pptx";

      canvas.style.display = "none";
      pptContainer.innerHTML = "";

if (window.jQuery && $("#pptContainer").pptxToHtml) {

  $("#pptContainer").pptxToHtml({
    pptxFileUrl: url
  });

} else {

  console.error("pptxjs není načteno");

}

      setTimeout(() => {

        totalSlides = document.querySelectorAll("#pptContainer section").length;
        currentSlide = 1;
        showPptSlide();

      }, 500);

    }

  };

}

function renderPdf() {

  pdfDoc.getPage(currentSlide).then(page => {

    const viewport = page.getViewport({ scale: 1.5 });

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    page.render({
      canvasContext: ctx,
      viewport: viewport
    });

    slideInfo.innerText = currentSlide + " / " + totalSlides;

  });

}

function showPptSlide() {

  const slides = document.querySelectorAll("#pptContainer section");

  slides.forEach((s, i) => {
    s.style.display = (i === currentSlide - 1) ? "block" : "none";
  });

  slideInfo.innerText = currentSlide + " / " + totalSlides;

}

document.getElementById("slideNext").onclick = () => {

  if (currentSlide >= totalSlides) return;

  currentSlide++;

  if (fileType === "pdf") renderPdf();
  if (fileType === "pptx") showPptSlide();

};

document.getElementById("slidePrev").onclick = () => {

  if (currentSlide <= 1) return;

  currentSlide--;

  if (fileType === "pdf") renderPdf();
  if (fileType === "pptx") showPptSlide();

};

document.addEventListener("keydown", e => {

  if (e.key === "ArrowRight") document.getElementById("slideNext").click();
  if (e.key === "ArrowLeft") document.getElementById("slidePrev").click();

});

// ===== ZOBRAZENÍ / SKRYTÍ PREZENTACE =====

const presentationPanel = document.getElementById("presentationPanel");
const togglePresentationBtn = document.getElementById("togglePresentationBtn");

if (togglePresentationBtn && presentationPanel) {

  togglePresentationBtn.addEventListener("click", () => {

    if (presentationPanel.style.display === "none" || presentationPanel.style.display === "") {
      presentationPanel.style.display = "block";
    } else {
      presentationPanel.style.display = "none";
    }

  });

}
