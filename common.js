/* common.js */

// 1. 전역 상태
let allQuestions = [];
let currentIndex = 0;
let currentUser = JSON.parse(sessionStorage.getItem('quiz_user')) || { email: '', status: 'free' };

/**
 * 2. 회원가입
 */
async function handleSignUp() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    if (!email || !password) return alert("이메일과 비밀번호를 입력해주세요.");

    try {
        const response = await fetch('/api/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const result = await response.json();
        if (response.ok) alert("가입 확인 이메일을 보냈습니다!");
        else alert("가입 실패: " + result.message);
    } catch (error) {
        alert("서버 통신 오류");
    }
}

/**
 * 3. 로그인 및 세션 유지
 */
async function handleLogin() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    if (!email || !password) return alert("이메일과 비밀번호를 입력해주세요.");

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
        } else alert("로그인 실패: " + result.message);
    } catch (error) {
        alert("로그인 오류");
    }
}

/**
 * 4. 로그아웃 (premium.html에서 작동 확인 완료)
 */
function handleLogout() {
    if (confirm("로그아웃 하시겠습니까?")) {
        sessionStorage.removeItem('quiz_user');
        currentUser = { email: '', status: 'free' };
        location.href = 'index.html';
    }
}

/**
 * 5. 랜덤 출제 (필터 연동 로직)
 */
async function loadQuestions() {
    const area = document.getElementById('question-area');
    if (area) area.innerHTML = '<div class="loading" style="text-align:center; padding:50px;">데이터를 불러오는 중...</div>';

    const payload = {
        grade: document.getElementById('sel-grade')?.value,
        category: document.getElementById('sel-category')?.value,
        year: document.getElementById('sel-year')?.value,
        userStatus: currentUser.status
    };

    try {
        const response = await fetch('/api/questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) throw new Error("로드 실패");

        allQuestions = await response.json();
        currentIndex = 0;
        renderQuestion();
    } catch (error) {
        if (area) area.innerHTML = '<div class="error" style="text-align:center; padding:50px;">문제를 불러오지 못했습니다.</div>';
    }
}

/**
 * 6. 문제 카드 렌더링
 */
function renderQuestion() {
    const area = document.getElementById('question-area');
    if (!area || allQuestions.length === 0) {
        if (area) area.innerHTML = '<div class="card" style="text-align:center; padding:50px;">해당 조건의 문제가 데이터베이스에 없습니다.</div>';
        return;
    }

    const q = allQuestions[currentIndex];
    area.innerHTML = `
        <div class="card">
            <div class="card-header-info">
                <span>문제 ${currentIndex + 1}</span>
                <span>${q.category || ''} ${q.year ? '(' + q.year + '년)' : ''}</span>
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

/**
 * 7. 정답 확인
 */
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

/**
 * 8. index.html UI 갱신
 */
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
