import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { 
  CheckCircle2, Clock, MessageSquare, Plus, Trash2, Calendar, 
  Target, Save, Loader2, Database, Download, Upload 
} from 'lucide-react';

/**
 * [Vercel 배포 시 주의사항]
 * Vercel 설정창(Environment Variables)에 다음 두 항목을 반드시 추가해야 클라우드 저장이 작동합니다.
 * 1. VITE_FIREBASE_CONFIG : 파이어베이스 설정 JSON 문자열
 * 2. VITE_APP_ID : 프로젝트를 구분할 고유 이름 (예: my-planner)
 */

// --- 환경 변수 로드 ---
const rawConfig = import.meta.env?.VITE_FIREBASE_CONFIG;
let firebaseConfig = {};
try {
  if (rawConfig) firebaseConfig = JSON.parse(rawConfig);
} catch (e) {
  console.error("Firebase Config 파싱 실패:", e);
}

const appId = import.meta.env?.VITE_APP_ID || 'default-app-id';

// Firebase 서비스 초기화 (설정값이 있을 때만)
let app, auth, db;
if (firebaseConfig && firebaseConfig.apiKey) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

const App = () => {
  const [user, setUser] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const fileInputRef = useRef(null);

  // 플래너 데이터 상태
  const [tasks, setTasks] = useState([]);
  const [schedule, setSchedule] = useState({});
  const [feedback, setFeedback] = useState({ 
    identity: '', 
    reflection: '', 
    improvement: '' 
  });

  const getLocalTodayString = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // 1. 사용자 인증
  useEffect(() => {
    if (!auth) {
      setIsLoaded(true); // Firebase 설정이 없으면 로컬 모드로 시작
      return;
    }
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        console.error("인증 오류:", err);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. 실시간 데이터 동기화
  useEffect(() => {
    if (!user || !db) return;
    const todayStr = getLocalTodayString();
    const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'dailyPlans', todayStr);

    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setTasks(data.tasks ? JSON.parse(data.tasks) : []);
        setSchedule(data.schedule ? JSON.parse(data.schedule) : {});
        setFeedback(data.feedback ? JSON.parse(data.feedback) : { identity: '', reflection: '', improvement: '' });
      }
      setIsLoaded(true);
    }, (err) => {
      console.error("로딩 에러:", err);
      setIsLoaded(true);
    });

    return () => unsubscribe();
  }, [user]);

  // 3. JSON 내보내기 (구글 드라이브 보관용)
  const exportToJson = () => {
    const dataStr = JSON.stringify({ date: getLocalTodayString(), tasks, schedule, feedback }, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `planner_${getLocalTodayString()}.json`;
    link.click();
    setSaveMsg('JSON 내보내기 완료! 📂');
    setTimeout(() => setSaveMsg(''), 3000);
  };

  // 4. JSON 불러오기
  const importFromJson = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result);
        if (json.tasks) setTasks(json.tasks);
        if (json.schedule) setSchedule(json.schedule);
        if (json.feedback) setFeedback(json.feedback);
        setSaveMsg('데이터 불러오기 완료! ✅');
        setTimeout(() => setSaveMsg(''), 3000);
      } catch (err) { alert('JSON 형식이 잘못되었습니다.'); }
    };
    reader.readAsText(file);
  };

  // 5. 클라우드 저장
  const saveToCloud = async () => {
    if (!user || !db) {
      alert('클라우드 설정이 되어있지 않습니다. JSON 내보내기를 사용하세요.');
      return;
    }
    setSaveMsg('저장 중...');
    const todayStr = getLocalTodayString();
    const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'dailyPlans', todayStr);
    try {
      await setDoc(docRef, {
        tasks: JSON.stringify(tasks),
        schedule: JSON.stringify(schedule),
        feedback: JSON.stringify(feedback),
        updatedAt: new Date().toISOString()
      }, { merge: true });
      setSaveMsg('클라우드 저장 완료! ☁️');
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (e) { setSaveMsg('저장 실패!'); }
  };

  if (!isLoaded) return <div className="min-h-screen flex items-center justify-center bg-[#FAF9F6]"><Loader2 className="animate-spin text-[#E27D60]" size={32} /></div>;

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-[#17535B] font-sans p-4 md:p-8">
      {/* Header */}
      <header className="max-w-7xl mx-auto mb-8 flex flex-col md:flex-row justify-between items-end border-b-2 border-[#E27D60] pb-4 gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight uppercase">Daily Planner</h1>
          <p className="text-[10px] font-mono opacity-50 mt-1 flex items-center gap-1">
            <Database size={12} /> {db ? 'Cloud Sync Enabled' : 'Local File Mode (Check Vercel Env)'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {saveMsg && <span className="text-xs font-bold text-[#E27D60] mr-2">{saveMsg}</span>}
          <input type="file" ref={fileInputRef} onChange={importFromJson} className="hidden" accept=".json" />
          <button onClick={() => fileInputRef.current.click()} className="flex items-center gap-2 bg-white border border-[#17535B]/20 px-3 py-2 rounded-lg text-xs font-bold hover:bg-gray-50 transition-all"><Upload size={14} /> 불러오기</button>
          <button onClick={exportToJson} className="flex items-center gap-2 bg-white border border-[#17535B]/20 px-3 py-2 rounded-lg text-xs font-bold hover:bg-gray-50 transition-all"><Download size={14} /> 내보내기</button>
        </div>
      </header>

      {/* Main Layout */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: Identity & Feedback */}
        <div className="lg:col-span-3 space-y-6">
          <section className="bg-white p-6 rounded-2xl shadow-sm border border-[#17535B]/10">
            <h3 className="flex items-center gap-2 font-bold mb-4 text-[#E27D60]"><Target size={18} /> 정체성</h3>
            <textarea className="w-full h-32 p-3 text-sm bg-[#FAF9F6] rounded-xl border-none focus:ring-1 focus:ring-[#17535B] outline-none resize-none" value={feedback.identity} onChange={(e) => setFeedback({...feedback, identity: e.target.value})} placeholder="오늘 나는 어떤 사람인가요?" />
          </section>
          <section className="bg-white p-6 rounded-2xl shadow-sm border border-[#17535B]/10">
            <h3 className="flex items-center gap-2 font-bold mb-4 text-[#E27D60]"><MessageSquare size={18} /> 데일리 피드백</h3>
            <div className="space-y-4">
              <textarea className="w-full h-52 p-3 text-sm bg-[#FAF9F6] rounded-xl border-none focus:ring-1 focus:ring-[#17535B] outline-none resize-none" placeholder="잘한 점 / 성취" value={feedback.reflection} onChange={(e) => setFeedback({...feedback, reflection: e.target.value})} />
              <textarea className="w-full h-52 p-3 text-sm bg-[#FAF9F6] rounded-xl border-none focus:ring-1 focus:ring-[#17535B] outline-none resize-none" placeholder="개선할 점 / 다짐" value={feedback.improvement} onChange={(e) => setFeedback({...feedback, improvement: e.target.value})} />
            </div>
          </section>
        </div>

        {/* Center: Tasks */}
        <div className="lg:col-span-6 space-y-6">
          <section className="bg-white p-6 rounded-2xl shadow-sm border border-[#17535B]/10 h-full min-h-[600px]">
            <div className="flex justify-between items-center mb-6">
              <h3 className="flex items-center gap-2 font-bold text-xl"><CheckCircle2 size={22} className="text-[#E27D60]" /> 할 일 관리</h3>
              <button onClick={() => setTasks([...tasks, { id: Date.now(), text: '', status: '대기', reschedule: '' }])} className="p-2 bg-[#17535B] text-white rounded-full hover:shadow-lg transition-all"><Plus size={18} /></button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left opacity-40 text-[10px] uppercase tracking-widest border-b border-[#17535B]/10">
                  <th className="pb-2">내용</th>
                  <th className="pb-2 w-24">상태</th>
                  <th className="pb-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#17535B]/5">
                {tasks.map((task) => (
                  <tr key={task.id} className="group hover:bg-[#FAF9F6]/50">
                    <td className="py-3 pr-4"><input type="text" className="w-full bg-transparent border-none p-0 focus:ring-0 text-[#17535B]" value={task.text} onChange={(e) => setTasks(tasks.map(t => t.id === task.id ? {...t, text: e.target.value} : t))} placeholder="할 일을 입력하세요..." /></td>
                    <td className="py-2">
                      <select className={`text-[10px] font-bold p-1 rounded border-none w-full text-white ${task.status === '완료' ? 'bg-green-500' : task.status === '진행중' ? 'bg-blue-500' : task.status === '미루기' ? 'bg-red-500' : 'bg-[#FAF9F6] !text-[#17535B]'}`} value={task.status} onChange={(e) => setTasks(tasks.map(t => t.id === task.id ? {...t, status: e.target.value} : t))}>
                        <option className="bg-white text-[#17535B]">대기</option><option className="bg-white text-[#17535B]">진행중</option><option className="bg-white text-[#17535B]">완료</option><option className="bg-white text-[#17535B]">미루기</option>
                      </select>
                    </td>
                    <td className="py-2 text-right"><button onClick={() => setTasks(tasks.filter(t => t.id !== task.id))} className="text-red-300 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        {/* Right: TimeBox */}
        <div className="lg:col-span-3">
          <section className="bg-white p-6 rounded-2xl shadow-sm border border-[#17535B]/10 max-h-[85vh] overflow-y-auto custom-scrollbar">
            <h3 className="flex items-center gap-2 font-bold mb-4 border-b pb-2"><Clock size={18} className="text-[#E27D60]" /> Time Box</h3>
            <div className="space-y-1">
              {Array.from({ length: 37 }, (_, i) => {
                const h = Math.floor(i / 2) + 5;
                const m = i % 2 === 0 ? '00' : '30';
                const time = `${h.toString().padStart(2, '0')}:${m}`;
                return (
                  <div key={time} className="flex gap-2 py-1 items-center border-l-2 border-transparent hover:border-[#E27D60] pl-2 transition-all">
                    <span className="text-[10px] font-mono opacity-40 w-8">{time}</span>
                    <input type="text" className="flex-1 text-xs bg-transparent border-none p-0 focus:ring-0" placeholder="ㅡ" value={schedule[time] || ''} onChange={(e) => setSchedule({...schedule, [time]: e.target.value})} />
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{ __html: `.custom-scrollbar::-webkit-scrollbar { width: 4px; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #17535B20; border-radius: 10px; }` }} />
    </div>
  );
};

export default App;