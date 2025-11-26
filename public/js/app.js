// Initialize Socket.IO
const socket = io();

// Global state
let candidates = [];
let hasVoted = false;
let testMode = false; // When true, clicking candidate buttons doesn't submit votes — it only tests UI/audio
const TOTAL_SLOTS = 16;

// Load candidates on page load
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('admin') === 'true') {
        showAdminMode();
    } else {
        loadCandidates();
        checkLocalVoteStatus();
    }

    socket.on('candidates-updated', () => {
        loadCandidates();
        if (document.getElementById('admin-interface').classList.contains('active')) {
            loadAdminCandidates();
            loadResults();
        }
    });

    socket.on('vote-submitted', () => {
        loadResults();
        loadDetailedVotes();
        loadCandidates();
    });
});

function checkLocalVoteStatus() {
    if (localStorage.getItem('hasVoted') === 'true') {
        hasVoted = true;
    }
}

function startVoting() {
    // Check if already voted
    if (hasVoted || localStorage.getItem('hasVoted') === 'true') {
        alert('आपण आधीच मतदान केले आहे! (You have already voted!)');
        return;
    }

    // Hide start button, show ballot
    document.getElementById('start-voting-section').classList.add('hidden');
    document.getElementById('ballot-wrapper').classList.remove('hidden');
}

// Toggle between Test Mode and Start Voting
function toggleTestThenStart() {
    const toggleBtn = document.getElementById('test-toggle-btn');
    const instructions = document.getElementById('test-mode-instructions');

    // If not in test mode -> enter test mode and show ballot for testing
    if (!testMode) {
        testMode = true;
        // show ballot so users can click buttons for a quick test
        document.getElementById('ballot-wrapper').classList.remove('hidden');
        instructions.classList.remove('hidden');
        toggleBtn.textContent = '🗳️ Start Voting';
        // Re-render ballot so buttons will wire to testClick
        renderBallot();
        return;
    }

    // If already in test mode -> start actual voting
    testMode = false;
    instructions.classList.add('hidden');
    toggleBtn.textContent = '🛠️ Test Buttons';
    // Delegate to normal startVoting flow (which will check hasVoted)
    startVoting();
}

function showAdminMode() {
    document.getElementById('admin-interface').classList.remove('hidden');
    document.getElementById('admin-interface').classList.add('active');
    loadCandidates();
    loadAdminCandidates();
    loadResults();
    loadDetailedVotes();
}

async function loadCandidates() {
    try {
        const response = await fetch('/api/candidates');
        candidates = await response.json();
        renderBallot();
        if (document.getElementById('admin-interface').classList.contains('active')) {
            loadAdminCandidates();
        }
    } catch (error) {
        console.error('Error loading candidates:', error);
    }
}

function renderBallot() {
    const tbody = document.getElementById('candidates-list');
    if (!tbody) return;

    let html = '';

    for (let i = 0; i < TOTAL_SLOTS; i++) {
        const slotNum = i + 1;
        const candidate = candidates[i];

        if (candidate) {
            // Remove special highlighting on any particular slot so all rows render the same
            const isHighlighted = false;

            html += `
                <tr class="evm-row ${isHighlighted ? 'highlighted' : ''}" id="row-${candidate.id}">
                    <td class="sr-no">${slotNum}.</td>
                    <td class="candidate-name-cell">
                        <div class="candidate-name-text">${escapeHtml(candidate.name)}</div>
                    </td>
                    <td class="photo-cell">
                        ${candidate.image_url ?
                    `<img src="${escapeHtml(candidate.image_url)}" class="candidate-photo-img" onerror="this.style.display='none'">` :
                    ''}
                    </td>
                    <td class="symbol-cell">
                        ${renderSymbol(candidate.description)}
                    </td>
                    <td class="bulb-cell">
                        <div class="arrow-shape" id="arrow-${candidate.id}"></div>
                    </td>
                    <td class="btn-cell">
                                    <button class="evm-btn" onclick="handleVoteClick(${candidate.id})" ${(!testMode && hasVoted) ? 'disabled' : ''}>
                                        बटण दाबा
                        </button>
                    </td>
                </tr>
            `;
        } else {
            html += `
                <tr class="evm-row">
                    <td class="sr-no">${slotNum}.</td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td class="bulb-cell">
                        <div class="arrow-shape"></div>
                    </td>
                    <td class="btn-cell">
                        <button class="evm-btn" ${testMode ? '' : 'disabled'}>बटण दाबा</button>
                    </td>
                </tr>
            `;
        }
    }

    tbody.innerHTML = html;

    // --- Mobile rendering (separate UI) ---
    const mobileContainer = document.getElementById('mobile-ballot');
    if (mobileContainer) {
        const mobileIs = isMobileView();
        mobileContainer.setAttribute('aria-hidden', String(!mobileIs));

        let mobileHtml = '';
        for (let i = 0; i < TOTAL_SLOTS; i++) {
            const slotNum = i + 1;
            const candidate = candidates[i];

            if (candidate) {
                mobileHtml += `
                    <div class="mobile-card" id="mobile-${candidate.id}">
                        <div class="mobile-card-left">
                            ${candidate.image_url ? `<img src="${escapeHtml(candidate.image_url)}" class="mobile-photo" onerror="this.style.display='none'">` : ''}
                        </div>
                        <div class="mobile-card-center">
                            <div class="mobile-name">${escapeHtml(candidate.name)}</div>
                            <div class="mobile-symbol">${renderSymbol(candidate.description)}</div>
                        </div>
                        <div class="mobile-card-right">
                            <div class="mobile-bulb" id="mobile-arrow-${candidate.id}"></div>
                        </div>
                        <div class="mobile-card-action">
                            <button class="evm-btn mobile-evm-btn" onclick="handleVoteClick(${candidate.id})" ${(!testMode && hasVoted) ? 'disabled' : ''} aria-label="${escapeHtml(candidate.name)} बटण दाबा">बटण दाबा</button>
                        </div>
                    </div>
                `;
            } else {
                mobileHtml += `
                    <div class="mobile-card empty">
                        <div class="mobile-card-left"></div>
                        <div class="mobile-card-center empty-center">Slot ${slotNum} — खाली</div>
                        <div class="mobile-card-right"></div>
                        <div class="mobile-card-action">
                            <button class="evm-btn mobile-evm-btn" disabled>बटण दाबा</button>
                        </div>
                    </div>
                `;
            }
        }

        mobileContainer.innerHTML = mobileHtml;

        // Reflect active arrow when submitting in desktop/mobile
        // remove any mobile arrow active classes if present
        candidates.forEach(c => {
            const arrowEl = document.getElementById(`mobile-arrow-${c.id}`);
            if (arrowEl) arrowEl.className = 'mobile-bulb';
        });
    }
}

function isMobileView() {
    // consider 480px and below as mobile
    try {
        return window.matchMedia && window.matchMedia('(max-width: 480px)').matches;
    } catch (e) {
        return window.innerWidth <= 480;
    }
}

// re-render ballot when viewport changes so mobile/desktop UI toggles
let _lastMobile = isMobileView();
window.addEventListener('resize', () => {
    const nowMobile = isMobileView();
    if (nowMobile !== _lastMobile) {
        _lastMobile = nowMobile;
        renderBallot();
    }
});

function renderSymbol(symbolUrl) {
    if (!symbolUrl) return '';
    if (symbolUrl.length <= 4 || /[\u{1F300}-\u{1F9FF}]/u.test(symbolUrl)) {
        return `<span class="symbol-emoji">${symbolUrl}</span>`;
    }
    return `<img src="${escapeHtml(symbolUrl)}" class="symbol-img" onerror="this.outerHTML=''">`;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Audio Context for Beep
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playBeep() {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(3000, audioCtx.currentTime);

    // Extended to 4 seconds
    gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 4);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 4);
}

// Short beep for tests (non-blocking, short duration)
function playShortBeep(durationMs = 200) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(1500, audioCtx.currentTime);

    gainNode.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + (durationMs / 1000));

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + (durationMs / 1000));
}

// Test click — gives visual/audio feedback but does NOT submit a vote
function testClick(candidateId) {
    try {
        const arrow = document.getElementById(`arrow-${candidateId}`);
        const mobileArrow = document.getElementById(`mobile-arrow-${candidateId}`);
        if (arrow) {
            arrow.classList.add('active');
        }
        if (mobileArrow) mobileArrow.classList.add('active');

        // play a short beep
        playShortBeep(250);

        // show an ephemeral message in the test instructions area
        const instructions = document.getElementById('test-mode-instructions');
        const candidate = candidates.find(c => c.id === candidateId) || { name: 'Unknown' };
        const prev = instructions.textContent;
        instructions.textContent = `Test OK — ${candidate.name}`;

        // remove highlight + restore message after a short delay
        setTimeout(() => {
            if (arrow) arrow.classList.remove('active');
            if (mobileArrow) mobileArrow.classList.remove('active');
            instructions.textContent = prev;
        }, 800);

    } catch (err) {
        console.error('Error in testClick:', err);
    }
}

// wrapper used by markup to decide whether to test or submit (avoids nested templates)
function handleVoteClick(candidateId) {
    if (testMode) {
        testClick(candidateId);
    } else {
        submitVote(candidateId);
    }
}

// Submit Vote - NO CONFIRMATION POPUP
async function submitVote(candidateId) {
    if (hasVoted) {
        alert('You have already voted!');
        return;
    }

    // Visual Feedback: Glow the arrow (desktop and mobile)
    const arrow = document.getElementById(`arrow-${candidateId}`);
    const mobileArrow = document.getElementById(`mobile-arrow-${candidateId}`);
    if (arrow) arrow.classList.add('active');
    if (mobileArrow) mobileArrow.classList.add('active');

    // Audio Feedback: Play Beep (4 seconds)
    playBeep();

    try {
        const response = await fetch('/api/vote', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                candidateId: candidateId
            })
        });

        const data = await response.json();

        if (!response.ok) {
            alert(data.error || 'Failed to submit vote');
            if (data.error && data.error.includes('already voted')) {
                hasVoted = true;
                localStorage.setItem('hasVoted', 'true');
                renderBallot();
            }
            if (arrow) arrow.classList.remove('active');
            if (mobileArrow) mobileArrow.classList.remove('active');
            return;
        }

        hasVoted = true;
        localStorage.setItem('hasVoted', 'true');

        // Wait for beep to finish (4 seconds)
        setTimeout(() => {
            document.getElementById('vote-confirmation').classList.remove('hidden');
            document.querySelectorAll('.evm-btn').forEach(btn => btn.disabled = true);
        }, 4000);

    } catch (error) {
        console.error('Error submitting vote:', error);
        alert('Failed to submit vote. Please try again.');
        if (arrow) arrow.classList.remove('active');
        if (mobileArrow) mobileArrow.classList.remove('active');
    }
}

// Admin Functions

function showTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    if (tabName === 'manage') {
        document.querySelector('.tab-btn:nth-child(1)').classList.add('active');
        document.getElementById('manage-tab').classList.add('active');
    } else if (tabName === 'results') {
        document.querySelector('.tab-btn:nth-child(2)').classList.add('active');
        document.getElementById('results-tab').classList.add('active');
        loadResults();
        loadDetailedVotes();
    }
}

function loadAdminCandidates() {
    const container = document.getElementById('admin-candidates-list');
    if (!container) return;

    if (candidates.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #6b7280; padding: 20px;">No candidates added yet.</p>';
        return;
    }

    container.innerHTML = candidates.map((candidate, index) => `
        <div class="candidate-card">
            <div class="candidate-card-info">
                <strong>Slot ${index + 1}</strong>: ${escapeHtml(candidate.name)}<br>
                <small>Photo: ${candidate.image_url || 'None'}</small><br>
                <small>Symbol: ${candidate.description || 'None'}</small>
            </div>
            <div class="candidate-card-actions">
                <button class="btn btn-danger" onclick="deleteCandidate(${candidate.id})">Delete</button>
            </div>
        </div>
    `).join('');
}

async function saveCandidate() {
    const name = document.getElementById('candidate-name').value.trim();
    const photoUrl = document.getElementById('candidate-photo').value.trim();
    const symbolUrl = document.getElementById('candidate-symbol').value.trim();

    if (!name) {
        alert('Candidate name is required');
        return;
    }

    const candidateData = {
        name,
        description: symbolUrl,
        image_url: photoUrl
    };

    try {
        const response = await fetch('/api/candidates', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(candidateData)
        });

        if (!response.ok) {
            throw new Error('Failed to save candidate');
        }

        alert('Candidate added successfully!');
        document.getElementById('candidate-name').value = '';
        document.getElementById('candidate-photo').value = '';
        document.getElementById('candidate-symbol').value = '';

        loadCandidates();

    } catch (error) {
        console.error('Error saving candidate:', error);
        alert('Failed to save candidate. Please try again.');
    }
}

function cancelEdit() {
    document.getElementById('candidate-name').value = '';
    document.getElementById('candidate-photo').value = '';
    document.getElementById('candidate-symbol').value = '';
}

async function deleteCandidate(id) {
    if (!confirm('Are you sure you want to delete this candidate?')) {
        return;
    }

    try {
        const response = await fetch(`/api/candidates/${id}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('Failed to delete candidate');
        }

        loadCandidates();

    } catch (error) {
        console.error('Error deleting candidate:', error);
        alert('Failed to delete candidate. Please try again.');
    }
}

async function loadResults() {
    try {
        const response = await fetch('/api/results');
        const results = await response.json();

        const container = document.getElementById('results-chart');
        if (!container) return;

        const totalVotes = results.reduce((sum, r) => sum + r.vote_count, 0);

        if (totalVotes === 0) {
            container.innerHTML = '<p style="text-align: center; color: #6b7280; padding: 20px;">No votes have been cast yet.</p>';
            return;
        }

        container.innerHTML = results.map(result => {
            const percentage = totalVotes > 0 ? (result.vote_count / totalVotes * 100).toFixed(1) : 0;
            return `
                <div class="result-bar">
                    <div class="result-header">
                        <span class="result-name">${escapeHtml(result.name)}</span>
                        <span class="result-count">${result.vote_count} votes</span>
                    </div>
                    <div class="result-progress">
                        <div class="result-fill" style="width: ${percentage}%">
                            ${percentage}%
                        </div>
                    </div>
                </div>
            `;
        }).join('');

    } catch (error) {
        console.error('Error loading results:', error);
    }
}

async function loadDetailedVotes() {
    try {
        const response = await fetch('/api/votes/details');
        const votes = await response.json();

        const tbody = document.getElementById('detailed-votes-list');
        if (!tbody) return;

        if (votes.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: #6b7280; padding: 20px;">No votes recorded yet.</td></tr>';
            return;
        }

        tbody.innerHTML = votes.map(vote => `
            <tr>
                <td>${escapeHtml(vote.ip_address || 'Unknown')}</td>
                <td><strong>${escapeHtml(vote.candidate_name)}</strong></td>
                <td>${new Date(vote.timestamp).toLocaleString()}</td>
            </tr>
        `).join('');

    } catch (error) {
        console.error('Error loading detailed votes:', error);
    }
}

async function exportToExcel() {
    try {
        const response = await fetch('/api/export/excel');
        if (!response.ok) throw new Error('Failed to export');
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `voting_results_${new Date().getTime()}.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    } catch (error) {
        console.error('Error exporting:', error);
        alert('Failed to export data.');
    }
}

async function shareResults() {
    try {
        const response = await fetch('/api/results');
        const results = await response.json();
        const totalVotes = results.reduce((sum, r) => sum + r.vote_count, 0);
        let message = '📊 *Voting Results*\\n\\n';
        message += `Total Votes: ${totalVotes}\\n\\n`;
        results.forEach((result, index) => {
            const percentage = totalVotes > 0 ? (result.vote_count / totalVotes * 100).toFixed(1) : 0;
            message += `${index + 1}. ${result.name}\\n`;
            message += `   Votes: ${result.vote_count} (${percentage}%)\\n\\n`;
        });
        const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
        window.open(whatsappUrl, '_blank');
    } catch (error) {
        console.error('Error sharing results:', error);
        alert('Failed to share results.');
    }
}
