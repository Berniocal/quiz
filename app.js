import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getDatabase,
  ref,
  onValue,
  get,
  set,
  update,
  push,
  remove,
  runTransaction,
  off,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';

const firebaseConfig = {
    apiKey: "AIzaSyA-Y_qYftzPYHh9hCXUM7bMqK7j5pMVbzc",
    authDomain: "quiz-bad1f.firebaseapp.com",
    databaseURL: "https://quiz-bad1f-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "quiz-bad1f",
    storageBucket: "quiz-bad1f.firebasestorage.app",
    messagingSenderId: "443723924249",
    appId: "1:443723924249:web:1ef489b7cef75a7c143b88"
  };
const app = initializeApp(firebaseConfig);
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
  hostRoomCode: $('hostRoomCode'), hostState: $('hostState'), hostRound: $('hostRound'), pendingTeams: $('pendingTeams'), acceptedTeams: $('acceptedTeams'),
  startGameBtn: $('startGameBtn'), roundRoomCode: $('roundRoomCode'), roundNumber: $('roundNumber'), stopRoundBtn: $('stopRoundBtn'),
  resultsRoomCode: $('resultsRoomCode'), resultsRoundNumber: $('resultsRoundNumber'), answersList: $('answersList'), nextRoundBtn: $('nextRoundBtn'),
  endGameBtn: $('endGameBtn'), finalRanking: $('finalRanking'), newRoomBtn: $('newRoomBtn'), waitingText: $('waitingText'),
  playerTeamLabel: $('playerTeamLabel'), playerScoreLabel: $('playerScoreLabel'), playerRoundTeamLabel: $('playerRoundTeamLabel'),
  playerRoundNumber: $('playerRoundNumber'), answerInput: $('answerInput'), submitAnswerBtn: $('submitAnswerBtn'), submitState: $('submitState'),
  playerHoldTeamLabel: $('playerHoldTeamLabel'), playerHoldScoreLabel: $('playerHoldScoreLabel')
};

const state = {
  clientId: getOrCreateClientId(),
  roomCode: localStorage.getItem('quiz_roomCode') || '',
  teamId: localStorage.getItem('quiz_teamId') || '',
  role: localStorage.getItem('quiz_role') || '',
  unsubscribe: null,
  roomData: null
};

if (state.roomCode) els.roomCode.value = state.roomCode;

els.randomBtn.addEventListener('click', () => {
  els.roomCode.value = randomCode();
});
els.joinBtn.addEventListener('click', joinOrCreateRoom);
els.startGameBtn.addEventListener('click', startGame);
els.stopRoundBtn.addEventListener('click', stopRound);
els.nextRoundBtn.addEventListener('click', nextRound);
els.endGameBtn.addEventListener('click', endGame);
els.newRoomBtn.addEventListener('click', resetLocalState);
els.submitAnswerBtn.addEventListener('click', submitAnswer);

if (state.roomCode) subscribeRoom(state.roomCode);
render();

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

async function joinOrCreateRoom() {
  const roomCode = sanitizeCode(els.roomCode.value);
  const teamName = sanitizeName(els.teamName.value);
  if (!roomCode || roomCode.length !== 5) {
    alert('Zadej pětimístný kód místnosti.');
    return;
  }
  if (!teamName) {
    alert('Zadej jméno týmu.');
    return;
  }

  showOnly('loadingView');
  els.joinBtn.disabled = true;

  try {
    const roomRef = ref(db, `rooms/${roomCode}`);
    const tx = await runTransaction(roomRef, current => {
      if (current === null) {
        return {
          code: roomCode,
          createdAt: Date.now(),
          hostClientId: state.clientId,
          hostName: teamName,
          status: 'lobby',
          currentRound: 0,
          lastActionAt: Date.now(),
          teams: {}
        };
      }
      return current;
    }, { applyLocally: false });

    if (!tx.snapshot.exists()) {
      throw new Error('Nepodařilo se vytvořit nebo načíst místnost.');
    }

    const roomData = tx.snapshot.val();
    const isHost = roomData?.hostClientId === state.clientId;

    state.roomCode = roomCode;
    localStorage.setItem('quiz_roomCode', roomCode);
    subscribeRoom(roomCode);

    if (isHost) {
      state.role = 'host';
      state.teamId = '';
      localStorage.setItem('quiz_role', 'host');
      localStorage.removeItem('quiz_teamId');
      render();
      return;
    }

    state.role = 'player';
    localStorage.setItem('quiz_role', 'player');

    const teamsRef = ref(db, `rooms/${roomCode}/teams`);
    const existingTeams = (await get(teamsRef)).val() || {};
    const found = Object.entries(existingTeams).find(([, team]) => team.clientId === state.clientId);

    if (found) {
      state.teamId = found[0];
      const currentName = sanitizeName(found[1]?.name || '');
      if (teamName && currentName !== teamName) {
        await update(ref(db, `rooms/${roomCode}/teams/${state.teamId}`), { name: teamName });
      }
    } else {
      const newTeamRef = push(teamsRef);
      state.teamId = newTeamRef.key;
      await set(newTeamRef, {
        clientId: state.clientId,
        name: teamName,
        status: 'pending',
        score: 0,
        joinedAt: Date.now()
      });
    }

    localStorage.setItem('quiz_teamId', state.teamId);
    render();
  } catch (err) {
    console.error('joinOrCreateRoom error:', err);
    alert('Nepodařilo se připojit k místnosti. Zkus stránku obnovit a znovu.');
    render();
  } finally {
    els.joinBtn.disabled = false;
  }
}

function subscribeRoom(roomCode) {
  if (state.unsubscribe) state.unsubscribe();
  const roomRef = ref(db, `rooms/${roomCode}`);
  const callback = snapshot => {
    state.roomData = snapshot.val();
    if (!state.roomData) {
      resetLocalState(false);
      alert('Místnost už neexistuje.');
      return;
    }
    const hostId = state.roomData.hostClientId;
    if (hostId === state.clientId) {
      state.role = 'host';
      localStorage.setItem('quiz_role', 'host');
    }
    render();
  };
  onValue(roomRef, callback);
  state.unsubscribe = () => off(roomRef, 'value', callback);
}

function showOnly(viewId) {
  Object.values(els).forEach(el => {
    if (el instanceof HTMLElement && el.id && el.id.endsWith('View')) el.classList.add('hidden');
  });
  if (els[viewId]) els[viewId].classList.remove('hidden');
}

function render() {
  els.localRole.textContent = roleLabel();
  els.roomInfo.textContent = `Místnost: ${state.roomCode || '—'}`;

  if (!state.roomData) {
    showOnly('joinView');
    return;
  }

  if (state.role === 'host') {
    renderHost();
  } else {
    renderPlayer();
  }
}

function roleLabel() {
  if (state.role === 'host') return 'Host';
  if (state.role === 'player') return 'Tým';
  return 'Nepřipojeno';
}

function renderHost() {
  const room = state.roomData;
  const teams = room.teams || {};
  const pending = Object.entries(teams).filter(([,t]) => t.status === 'pending');
  const accepted = Object.entries(teams).filter(([,t]) => t.status === 'accepted');

  els.hostRoomCode.textContent = state.roomCode;
  els.hostState.textContent = room.status;
  els.hostRound.textContent = room.currentRound || 0;
  els.roundRoomCode.textContent = state.roomCode;
  els.roundNumber.textContent = room.currentRound || 1;
  els.resultsRoomCode.textContent = state.roomCode;
  els.resultsRoundNumber.textContent = room.currentRound || 1;

  renderPendingList(pending);
  renderAcceptedList(accepted);

  if (room.status === 'lobby') {
    showOnly('hostLobbyView');
    els.startGameBtn.disabled = accepted.length === 0;
  } else if (room.status === 'round_active') {
    showOnly('hostRoundView');
  } else if (room.status === 'round_stopped') {
    showOnly('hostResultsView');
    renderAnswers();
  } else if (room.status === 'finished') {
    showOnly('hostFinalView');
    renderFinalRanking();
  } else {
    showOnly('hostLobbyView');
  }
}

function renderPendingList(pending) {
  els.pendingTeams.innerHTML = '';
  if (!pending.length) {
    els.pendingTeams.innerHTML = '<div class="empty">Nikdo momentálně nečeká.</div>';
    return;
  }
  for (const [teamId, team] of pending.sort((a,b)=>(a[1].joinedAt||0)-(b[1].joinedAt||0))) {
    const row = document.createElement('div');
    row.className = 'teamRow';
    row.innerHTML = `
      <div class="teamMeta">
        <div class="teamName">${escapeHtml(team.name || 'Bez názvu')}</div>
        <div class="teamSub">Čeká od ${formatClock(team.joinedAt)}</div>
      </div>
      <div class="teamActions">
        <button data-team="${teamId}" data-action="accept">Přijmout</button>
        <button class="secondary" data-team="${teamId}" data-action="reject">Odmítnout</button>
      </div>`;
    row.querySelectorAll('button').forEach(btn => btn.addEventListener('click', async e => {
      const action = e.currentTarget.dataset.action;
      await update(ref(db, `rooms/${state.roomCode}/teams/${teamId}`), { status: action === 'accept' ? 'accepted' : 'rejected' });
    }));
    els.pendingTeams.appendChild(row);
  }
}

function renderAcceptedList(accepted) {
  els.acceptedTeams.innerHTML = '';
  if (!accepted.length) {
    els.acceptedTeams.innerHTML = '<div class="empty">Zatím nebyl přijat žádný tým.</div>';
    return;
  }
  for (const [, team] of accepted.sort((a,b)=>(b[1].score||0)-(a[1].score||0) || (a[1].joinedAt||0)-(b[1].joinedAt||0))) {
    const row = document.createElement('div');
    row.className = 'teamRow';
    row.innerHTML = `
      <div class="teamMeta">
        <div class="teamName">${escapeHtml(team.name || 'Bez názvu')}</div>
        <div class="teamSub">Body: ${team.score || 0}</div>
      </div>
      <div class="pill">Přijato</div>`;
    els.acceptedTeams.appendChild(row);
  }
}

function getMyTeam() {
  const teams = state.roomData?.teams || {};
  return state.teamId ? teams[state.teamId] : null;
}

function renderPlayer() {
  const room = state.roomData;
  const myTeam = getMyTeam();
  if (!myTeam) {
    showOnly('joinView');
    return;
  }

  els.playerTeamLabel.textContent = myTeam.name || '—';
  els.playerScoreLabel.textContent = myTeam.score || 0;
  els.playerRoundTeamLabel.textContent = myTeam.name || '—';
  els.playerRoundNumber.textContent = room.currentRound || 1;
  els.playerHoldTeamLabel.textContent = myTeam.name || '—';
  els.playerHoldScoreLabel.textContent = myTeam.score || 0;

  if (myTeam.status === 'pending') {
    showOnly('playerWaitingView');
    els.waitingText.textContent = 'Host ještě nepotvrdil připojení tvého týmu.';
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
      els.submitState.textContent = `Odpověď už byla odeslána za ${formatElapsed(answer.elapsedMs)}.`;
    } else {
      els.answerInput.disabled = false;
      els.submitAnswerBtn.disabled = false;
      els.submitState.textContent = 'Odpověď můžete odeslat jen jednou za kolo.';
    }
    return;
  }
  if (room.status === 'round_stopped') {
    showOnly('playerHoldView');
    return;
  }
  if (room.status === 'finished') {
    showOnly('playerHoldView');
    const rank = finalRankingData().findIndex(item => item.teamId === state.teamId) + 1;
    els.playerHoldScoreLabel.textContent = `${myTeam.score || 0} (pořadí ${rank || '—'})`;
    return;
  }
  showOnly('playerReadyView');
}

function currentAnswer() {
  const room = state.roomData;
  if (!room || !state.teamId) return null;
  const round = room.currentRound;
  const data = room.rounds?.[round]?.[state.teamId];
  return data || null;
}

async function startGame() {
  const accepted = Object.values(state.roomData?.teams || {}).filter(t => t.status === 'accepted');
  if (!accepted.length) {
    alert('Nejdřív přijmi alespoň jeden tým.');
    return;
  }
  const nextRoundNumber = (state.roomData.currentRound || 0) + 1;
  await update(ref(db, `rooms/${state.roomCode}`), {
    status: 'round_active',
    currentRound: nextRoundNumber,
    roundStartedAt: Date.now(),
    roundStoppedAt: null,
    lastActionAt: Date.now()
  });
}

async function stopRound() {
  await update(ref(db, `rooms/${state.roomCode}`), {
    status: 'round_stopped',
    roundStoppedAt: Date.now(),
    lastActionAt: Date.now()
  });
}

async function nextRound() {
  els.answerInput.value = '';
  await update(ref(db, `rooms/${state.roomCode}`), {
    status: 'round_active',
    currentRound: (state.roomData.currentRound || 0) + 1,
    roundStartedAt: Date.now(),
    roundStoppedAt: null,
    lastActionAt: Date.now()
  });
}

async function endGame() {
  await update(ref(db, `rooms/${state.roomCode}`), {
    status: 'finished',
    roundStoppedAt: Date.now(),
    lastActionAt: Date.now()
  });
}

async function submitAnswer() {
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
  const elapsedMs = Math.max(0, now - (room.roundStartedAt || now));
  await set(answerRef, {
    teamId: state.teamId,
    teamName: myTeam.name,
    answer,
    submittedAt: now,
    elapsedMs
  });
}

function renderAnswers() {
  const room = state.roomData;
  const teams = room.teams || {};
  const round = room.currentRound;
  const answers = Object.entries(room.rounds?.[round] || {}).map(([teamId, val]) => ({
    teamId,
    name: teams[teamId]?.name || val.teamName || 'Bez názvu',
    score: teams[teamId]?.score || 0,
    answer: val.answer || '',
    elapsedMs: val.elapsedMs ?? 999999999,
    submittedAt: val.submittedAt || 0
  })).sort((a,b) => (a.elapsedMs - b.elapsedMs) || (a.submittedAt - b.submittedAt));

  const missing = Object.entries(teams)
    .filter(([,t]) => t.status === 'accepted')
    .filter(([teamId]) => !answers.some(a => a.teamId === teamId))
    .map(([teamId, t]) => ({ teamId, name: t.name, score: t.score || 0, answer: 'Neodesláno', elapsedMs: null }));

  const all = [...answers, ...missing];
  els.answersList.innerHTML = '';
  if (!all.length) {
    els.answersList.innerHTML = '<div class="empty">V tomto kole zatím není žádná odpověď.</div>';
    return;
  }

  for (const item of all) {
    const row = document.createElement('div');
    row.className = 'answerRow';
    row.innerHTML = `
      <div class="scoreBox" id="score-${item.teamId}">${item.score}</div>
      <div class="answerMain">
        <div class="answerTitle">${escapeHtml(item.name)}</div>
        <div class="answerText">${escapeHtml(item.answer)}</div>
        <div class="answerTime">${item.elapsedMs == null ? 'bez času' : 'čas: ' + formatElapsed(item.elapsedMs)}</div>
      </div>
      <div class="pmBox">
        <button class="iconBtn plus" data-team="${item.teamId}" data-delta="1">+</button>
        <button class="iconBtn minus" data-team="${item.teamId}" data-delta="-1">−</button>
      </div>`;
    row.querySelectorAll('button').forEach(btn => btn.addEventListener('click', async e => {
      const teamId = e.currentTarget.dataset.team;
      const delta = Number(e.currentTarget.dataset.delta || 0);
      await adjustScore(teamId, delta);
    }));
    els.answersList.appendChild(row);
  }
}

async function adjustScore(teamId, delta) {
  const teamScoreRef = ref(db, `rooms/${state.roomCode}/teams/${teamId}/score`);
  await runTransaction(teamScoreRef, current => Math.max(0, Number(current || 0) + delta));
}

function finalRankingData() {
  const teams = Object.entries(state.roomData?.teams || {})
    .filter(([,t]) => t.status === 'accepted')
    .map(([teamId, t]) => ({ teamId, name: t.name || 'Bez názvu', score: t.score || 0, joinedAt: t.joinedAt || 0 }))
    .sort((a,b) => (b.score - a.score) || (a.joinedAt - b.joinedAt));
  return teams;
}

function renderFinalRanking() {
  const data = finalRankingData();
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
        <div class="small">Celkem bodů</div>
      </div>
      <div class="scoreBox">${item.score}</div>`;
    els.finalRanking.appendChild(row);
  });
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.round(ms));
  const sec = Math.floor(total / 1000);
  const rest = String(total % 1000).padStart(3, '0');
  return `${sec}.${rest} s`;
}

function formatClock(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function resetLocalState(reload = true) {
  if (state.unsubscribe) state.unsubscribe();
  localStorage.removeItem('quiz_roomCode');
  localStorage.removeItem('quiz_role');
  localStorage.removeItem('quiz_teamId');
  state.roomCode = '';
  state.teamId = '';
  state.role = '';
  state.roomData = null;
  if (reload) location.reload();
}
