/* common.js */

let allQuestions = [];
let currentIndex = 0;
let currentUser = JSON.parse(sessionStorage.getItem('quiz_user')) || { email: '', status: 'free' };

// 페이지 로드 시 세션 복구 및 UI 반영
document.addEventListener('DOMContentLoaded', () => {
    const savedUser = sessionStorage.getItem('quiz_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        const emailDisp = document.getElementById('display-email');
        const statusDisp = document.getElementById('display-status');
        if (emailDisp) emailDisp.innerText = currentUser.email;
        if (statusDisp) statusDisp.innerText = currentUser.status.toUpperCase();
        updateUserUI();
    }
});

async function handleLogin() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    if (!email || !password) return alert("입력창을 확인해주세요.");

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const result = await response.json();
        if (response.ok) {
            currentUser = { email: result.user.email, status: result.status };
            sessionStorage.setItem('quiz_user', JSON.stringify(currentUser));
            if (currentUser.status === 'premium' || currentUser.status === 'admin') {
                location.href = 'premium.html';
            } else {
                alert("로그인 성공!");
                updateUserUI();
            }
        } else alert("실패: " + result.message);
    } catch (e) { alert("서버 오류"); }
}

function handleLogout() {
    if (confirm("로그아웃 하시겠습니까?")) {
        sessionStorage.removeItem('quiz_user');
        location.href = 'index.html';
    }
}

// 랜덤 출제 실행
async function loadQuestions() {
    const area = document.getElementById('question-area');
    if (area) area.innerHTML = '<div class="loading" style="text-align:center; padding:50px;">데이터 로드 중...</div>';

    const payload = {
        grade: document.getElementById('sel-grade')?.value,
        category: document.getElementById('sel-category')?.value,
        year: document.getElementById('sel-year')?.value, // 예: "2010"
        userStatus: currentUser.status
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
        if (area) area.innerHTML = '<div class="error" style="text-align:center; padding:50px;">불러오기 실패</div>';
    }
}

// 문제 렌더링 (exam_date 추출 반영)
function renderQuestion() {
    const area = document.getElementById('question-area');
    if (!area || allQuestions.length === 0) {
        if (area) area.innerHTML = '<div class="card" style="text-align:center; padding:50px;">조건에 맞는 문제가 없습니다.</div>';
        return;
    }

    const q = allQuestions[currentIndex];
    // exam_date(20100905)에서 연도(2010)만 추출
    const displayYear = q.exam_date ? String(q.exam_date).substring(0, 4) + '년' : '';

    area.innerHTML = `
        <div class="card">
            <div class="card-header-info">
                <span>문제 ${currentIndex + 1}</span>
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
            <div id="result-box" class="result-box" style="display:none; margin-top:20px; text-align:center;"></div>
            <div class="card-footer">
                <button class="btn-nav" onclick="changeQuestion(-1)" ${currentIndex === 0 ? 'disabled' : ''}>이전</button>
                <span class="page-indicator">${currentIndex + 1} / ${allQuestions.length}</span>
                <button class="btn-nav active" onclick="changeQuestion(1)" ${currentIndex === allQuestions.length - 1 ? 'disabled' : ''}>다음</button>
            </div>
        </div>
    `;
}

function checkAnswer(selected) {
    const correct = allQuestions[currentIndex].answer;
    const resultBox = document.getElementById('result-box');
    const btns = document.querySelectorAll('.choice-btn');
    btns.forEach(btn => btn.style.pointerEvents = 'none');

    if (selected == correct) {
        document.getElementById(`choice-${selected}`).style.borderColor = "#2ecc71";
        document.getElementById(`choice-${selected}`).style.backgroundColor = "#eafaf2";
        resultBox.innerHTML = "<span style='color: #2ecc71; font-weight:bold;'>✅ 정답입니다!</span>";
    } else {
        document.getElementById(`choice-${selected}`).style.borderColor = "#e74c3c";
        document.getElementById(`choice-${selected}`).style.backgroundColor = "#fdf0ee";
        document.getElementById(`choice-${correct}`).style.borderColor = "#2ecc71";
        resultBox.innerHTML = `<span style='color: #e74c3c; font-weight:bold;'>❌ 오답입니다. 정답은 ${correct}번입니다.</span>`;
    }
    resultBox.style.display = 'block';
}

function changeQuestion(step) {
    currentIndex += step;
    renderQuestion();
}

function updateUserUI() {
    const guestView = document.getElementById('guest-view');
    const userView = document.getElementById('user-view');
    const info = document.getElementById('user-display-info');
    if (currentUser.email && guestView && userView) {
        guestView.style.display = 'none';
        userView.style.display = 'block';
        if (info) info.innerText = `${currentUser.email}님 (등급: ${currentUser.status.toUpperCase()})`;
    }
}
