/* common.js - 최종 통합본 */

// 1. 전역 상태 관리
let allQuestions = [];
let currentIndex = 0;
// 세션에서 유저 정보를 가져오되, status 필드 명칭을 통일성 있게 관리합니다.
let currentUser = JSON.parse(sessionStorage.getItem('quiz_user')) || { email: '', status: 'free' };
let currentTargetUserId = null; 

/**
 * 2. 초기 로드 및 UI 업데이트
 */
document.addEventListener('DOMContentLoaded', () => {
    updateUserUI(); 

    // 관리자 여부 확인 후 버튼 노출
    // 세션의 status 또는 user_status 둘 다 대응하도록 작성
    const userRole = currentUser.status || currentUser.user_status;
    if (userRole === 'admin') {
        const adminBtn = document.getElementById('btn-admin-menu');
        if (adminBtn) {
            adminBtn.style.display = 'inline-block';
            adminBtn.innerText = "📊 통계 대시보드";
        }
    }
});

function updateUserUI() {
    const savedUser = sessionStorage.getItem('quiz_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        const guestView = document.getElementById('guest-view');
        const userView = document.getElementById('user-view');
        const info = document.getElementById('user-display-info');
        const emailEl = document.getElementById('display-email');
        const statusEl = document.getElementById('display-status');

        if (guestView && userView) {
            guestView.style.display = 'none';
            userView.style.display = 'block';
            const role = (currentUser.status || currentUser.user_status || 'free').toUpperCase();
            if (info) info.innerText = `${currentUser.email}님 (등급: ${role})`;
            if (emailEl) emailEl.innerText = currentUser.email;
            if (statusEl) statusEl.innerText = role;
        }
    }
}

/**
 * 3. 인증 관련 함수
 */
async function handleSignUp() {
    const email = document.getElementById('email')?.value;
    const password = document.getElementById('password')?.value;
    if (!email || !password) return alert("이메일과 비밀번호를 입력해주세요.");

    try {
        const response = await fetch('/api/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const result = await response.json();
        if (response.ok) alert("가입 확인 이메일을 보냈습니다! 메일함을 확인해 주세요.");
        else alert("가입 실패: " + result.message);
    } catch (e) { alert("서버 통신 오류"); }
}

async function handleLogin() {
    const email = document.getElementById('email')?.value;
    const password = document.getElementById('password')?.value;
    if (!email || !password) return alert("정보를 입력해주세요.");

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const result = await response.json();
        if (response.ok) {
            // 서버 응답의 status를 저장
            currentUser = { email: result.user.email, status: result.status };
            sessionStorage.setItem('quiz_user', JSON.stringify(currentUser));
            
            if (currentUser.status === 'premium' || currentUser.status === 'admin') {
                location.href = 'premium.html';
            } else {
                alert("로그인 성공!");
                updateUserUI();
            }
        } else alert(result.message);
    } catch (e) { alert("로그인 서버 오류"); }
}

function handleLogout() {
    if (confirm("로그아웃 하시겠습니까?")) {
        sessionStorage.removeItem('quiz_user');
        location.href = 'index.html';
    }
}

/**
 * 4. 퀴즈 엔진 함수
 */
async function loadQuestions() {
    const area = document.getElementById('question-area');
    if (area) area.innerHTML = '<div style="text-align:center; padding:50px;">데이터 로드 중...</div>';

    const payload = {
        grade: document.getElementById('sel-grade')?.value,
        category: document.getElementById('sel-category')?.value,
        year: document.getElementById('sel-year')?.value,
        limit: parseInt(document.getElementById('sel-limit')?.value || 20),
        userStatus: currentUser.status || currentUser.user_status
    };

    try {
        const response = await fetch('/api/questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        allQuestions = await response.json();
        currentIndex = 0;
        renderQuestion();
    } catch (e) {
        if (area) area.innerHTML = '<div style="text-align:center; padding:50px;">불러오기 실패</div>';
    }
}

function renderQuestion() {
    const area = document.getElementById('question-area');
    if (!area || allQuestions.length === 0) {
        if (area) area.innerHTML = '<div class="card" style="text-align:center; padding:50px;">해당 조건의 문제가 없습니다.</div>';
        return;
    }

    const q = allQuestions[currentIndex];
    const displayYear = q.exam_date ? String(q.exam_date).substring(0, 4) + '년' : '';

    area.innerHTML = `
        <div class="card">
            <div class="card-header-info">
                <span>문제 ${currentIndex + 1} / ${allQuestions.length}</span>
                <span>${q.category || ''} ${displayYear ? '(' + displayYear + ')' : ''}</span>
            </div>
            <div class="card-question">${q.question}</div>
            <div class="choices">
                ${[1, 2, 3, 4].map(num => `
                    <button class="choice-btn" id="choice-${num}" onclick="checkAnswer(${num})">
                        <span class="choice-num">${num}</span>
                        <span class="choice-text">${q['choice' + num]}</span>
                    </button>
                `).join('')}
            </div>
            <div id="result-box" class="result-box" style="display:none; margin-top:25px; text-align:center;"></div>
            <div class="card-footer">
                <button class="btn-nav" onclick="changeQuestion(-1)" ${currentIndex === 0 ? 'disabled' : ''}>이전</button>
                <button class="btn-nav active" onclick="changeQuestion(1)" ${currentIndex === allQuestions.length - 1 ? 'disabled' : ''}>다음</button>
            </div>
        </div>
    `;
}

function checkAnswer(selected) {
    const q = allQuestions[currentIndex];
    const correct = q.answer;
    const resultBox = document.getElementById('result-box');
    const btns = document.querySelectorAll('.choice-btn');

    btns.forEach(btn => btn.style.pointerEvents = 'none');

    let resultHTML = "";
    if (selected == correct) {
        const selectedBtn = document.getElementById(`choice-${selected}`);
        selectedBtn.style.borderColor = "#2ecc71";
        selectedBtn.style.backgroundColor = "#eafaf2";
        resultHTML = `<div style="color:#2ecc71; font-weight:800; font-size:1.2rem; margin-bottom:10px;">✅ 정답입니다!</div>`;
    } else {
        const selectedBtn = document.getElementById(`choice-${selected}`);
        const correctBtn = document.getElementById(`choice-${correct}`);
        selectedBtn.style.borderColor = "#e74c3c";
        selectedBtn.style.backgroundColor = "#fdf0ee";
        correctBtn.style.borderColor = "#2ecc71";
        correctBtn.style.backgroundColor = "#f0fff4";
        resultHTML = `
            <div style="color:#e74c3c; font-weight:800; font-size:1.2rem; margin-bottom:10px;">❌ 오답입니다.</div>
            <div style="background:#f8f9fa; padding:12px; border-radius:8px; margin-bottom:15px;">정답은 <strong>${correct}번</strong> 입니다.</div>
        `;
    }

    if (q.explanation) {
        resultHTML += `<div style="text-align:left; background:#f0f4ff; border-left:4px solid #364d79; padding:15px; border-radius:8px; margin-top:15px;">
            <strong>💡 해설:</strong><br>${q.explanation}</div>`;
    }

    resultBox.innerHTML = resultHTML;
    resultBox.style.display = 'block';
}

function changeQuestion(step) {
    currentIndex += step;
    renderQuestion();
}

/**
 * 5. 관리자 대시보드 함수
 */
function toggleAdminPanel() {
    const adminPanel = document.getElementById('admin-panel');
    const filterBar = document.querySelector('.filter-bar');
    const questionArea = document.getElementById('question-area');
    const adminBtn = document.getElementById('btn-admin-menu');
    
    const isOpening = adminPanel.style.display === 'none';

    if (isOpening) {
        adminPanel.style.display = 'block';
        if (filterBar) filterBar.style.display = 'none';
        if (questionArea) questionArea.style.display = 'none';
        adminBtn.innerText = "✕ 대시보드 닫기";
        loadAdminStats();
        loadUserList();
    } else {
        adminPanel.style.display = 'none';
        if (filterBar) filterBar.style.display = 'flex';
        if (questionArea) questionArea.style.display = 'block';
        adminBtn.innerText = "📊 통계 대시보드";
    }
}

async function loadAdminStats() {
    const role = currentUser.status || currentUser.user_status;
    if (role !== 'admin') return;

    try {
        const response = await fetch('/api/admin/stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userStatus: role })
        });
        const stats = await response.json();
        document.getElementById('stat-total-questions').innerText = (stats.totalQuestions || 0).toLocaleString();
        document.getElementById('stat-today-users').innerText = (stats.activeUsers || 0).toLocaleString();
        document.getElementById('stat-premium-rate').innerText = (stats.premiumRate || 0) + "%";
    } catch (e) { console.error("통계 로드 실패", e); }
}

async function loadUserList() {
    const role = currentUser.status || currentUser.user_status;
    try {
        const response = await fetch('/api/admin/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userStatus: role })
        });
        const users = await response.json();
        const tbody = document.getElementById('user-list-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        users.forEach(user => {
            const tr = document.createElement('tr');
            const uStatus = user.user_status || 'free';
            let expiryDisplay = user.expiry_date ? user.expiry_date.split('T')[0] : "-";
            
            tr.innerHTML = `
                <td style="text-align: left; padding-left: 15px;">${user.email}</td>
                <td style="text-align: center;"><span class="badge-${uStatus}">${uStatus.toUpperCase()}</span></td>
                <td style="text-align: center;">${expiryDisplay}</td>
                <td style="text-align: center;">
                    <select onchange="updateUserStatus('${user.id}', this.value)">
                        <option value="free" ${uStatus === 'free' ? 'selected' : ''}>FREE</option>
                        <option value="premium" ${uStatus === 'premium' ? 'selected' : ''}>PREMIUM</option>
                        <option value="admin" ${uStatus === 'admin' ? 'selected' : ''}>ADMIN</option>
                    </select>
                    <button onclick="setExpiryDate('${user.id}')">📅</button>
                    <button onclick="deleteUser('${user.id}', '${user.email}')" title="회원 삭제" style="cursor:pointer; background:none; border:none; font-size:1.1rem; color:#e74c3c;">🗑️</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) { console.error("목록 로드 실패", e); }
}

async function refreshAdminDashboard() {
    const btn = document.querySelector('.btn-refresh-stats');
    if(btn) btn.innerText = "로딩 중...";
    await loadAdminStats();
    await loadUserList();
    if(btn) btn.innerText = "데이터 새로고침";
}

/**
 * 6. 만료일 및 등급 관리
 */
function setExpiryDate(userId) {
    currentTargetUserId = userId;
    const datePicker = document.getElementById('hidden-date-picker');
    if (datePicker) datePicker.showPicker();
}

async function handleDateSelected() {
    const datePicker = document.getElementById('hidden-date-picker');
    const selectedDate = datePicker.value;
    const role = currentUser.status || currentUser.user_status;

    if (!selectedDate || !currentTargetUserId) return;
    if (!confirm(`만료일을 ${selectedDate}로 변경하시겠습니까?`)) return;

    try {
        const response = await fetch('/api/admin/update-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                targetUserId: currentTargetUserId, 
                expiryDate: selectedDate,
                userStatus: role 
            })
        });
        if (response.ok) {
            alert("변경 완료");
            refreshAdminDashboard();
        }
    } catch (e) { alert("통신 오류"); }
}

/* common.js 수정본 */

async function updateUserStatus(userId, newStatus) {
    let expiryDate = null;

    // 1. 프리미엄일 경우 날짜를 먼저 물어봄
    if (newStatus === 'premium') {
        const selectedDate = prompt("Premium 만료일을 입력해주세요 (YYYY-MM-DD)", "2025-12-31");
        if (!selectedDate) return; // 취소 시 중단
        expiryDate = selectedDate;
    }

    if (!confirm(`${newStatus.toUpperCase()} 등급으로 변경하시겠습니까?`)) return;

    // 현재 관리자 권한 정보
    const adminRole = currentUser.status || currentUser.user_status;

    try {
        const response = await fetch('/api/admin/update-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                targetUserId: userId, 
                newStatus: newStatus,  // 'premium' 전달
                expiryDate: expiryDate, // 설정한 날짜 전달
                userStatus: adminRole 
            })
        });

        const result = await response.json();

        if (response.ok) {
            alert("등급과 만료일이 성공적으로 변경되었습니다.");
            refreshAdminDashboard(); // 목록 새로고침
        } else {
            alert("변경 실패: " + result.message);
        }
    } catch (e) {
        console.error(e);
        alert("통신 에러가 발생했습니다.");
    }
}

window.deleteUser = async function(userId, email) {
    if (!confirm(`[경고] ${email} 사용자를 정말 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
        return;
    }

    const role = currentUser.status || currentUser.user_status;

    try {
        const response = await fetch('/api/admin/delete-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                targetUserId: userId, 
                userStatus: role 
            })
        });

        if (response.ok) {
            alert("회원 정보가 성공적으로 삭제되었습니다.");
            refreshAdminDashboard(); // 목록 새로고침
        } else {
            const result = await response.json();
            alert("삭제 실패: " + result.message);
        }
    } catch (e) {
        console.error(e);
        alert("통신 오류가 발생했습니다.");
    }
};
