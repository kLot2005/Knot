'use client';
import { useEffect, useState } from 'react';
import styles from './settings.module.css';

const API_BASE = 'http://localhost:5000/api';

export default function Settings() {
    const [clusterCron, setClusterCron] = useState('*/5 * * * *');
    const [pollInterval, setPollInterval] = useState(60);
    const [msg, setMsg] = useState({ text: '', isError: false });
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        fetch(`${API_BASE}/settings`)
            .then(r => r.json())
            .then(d => {
                setClusterCron(d.clusterCron);
                setPollInterval(d.pollInterval);
            })
            .catch(console.error);
    }, []);

    const save = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clusterCron, pollInterval })
            });
            const d = await res.json();
            setMsg({ text: d.message, isError: false });
        } catch (e) {
            setMsg({ text: 'Ошибка сохранения', isError: true });
        } finally {
            setLoading(false);
            setTimeout(() => setMsg({ text: '', isError: false }), 4000);
        }
    };

    return (
        <div className="animate-fade">
            <h1>Настройки системы</h1>

            <div className={styles.grid}>
                <div className={styles.card}>
                    <div className={styles.cardHeader}>
                        <h3>Расписание кластеризации</h3>
                        <span className={styles.badge}>BullMQ</span>
                    </div>
                    <p className={styles.desc}>
                        Cron-паттерн определяет, как часто запускать алгоритм группировки новостей.
                    </p>
                    <div className={styles.inputGroup}>
                        <label>Cron Expression</label>
                        <input
                            className={styles.input}
                            value={clusterCron}
                            onChange={e => setClusterCron(e.target.value)}
                        />
                    </div>
                    <div className={styles.presets}>
                        {['*/1 * * * *', '*/5 * * * *', '*/15 * * * *', '0 * * * *'].map(v => (
                            <button key={v} className={styles.presetBtn} onClick={() => setClusterCron(v)}>
                                {v === '0 * * * *' ? '1ч' : v.split(' ')[0].replace('*/', '') + 'м'}
                            </button>
                        ))}
                    </div>
                </div>

                <div className={styles.card}>
                    <div className={styles.cardHeader}>
                        <h3>Интервал опроса (Polling)</h3>
                        <span className={styles.badge}>Parser</span>
                    </div>
                    <p className={styles.desc}>
                        Задержка между принудительными запросами к Telegram API для поиска новых сообщений.
                    </p>
                    <div className={styles.inputGroup}>
                        <label>Интервал (сек)</label>
                        <input
                            className={styles.input}
                            type="number"
                            value={pollInterval}
                            onChange={e => setPollInterval(parseInt(e.target.value))}
                        />
                    </div>
                    <div className={styles.presets}>
                        {[15, 30, 60, 120].map(v => (
                            <button key={v} className={styles.presetBtn} onClick={() => setPollInterval(v)}>
                                {v >= 60 ? (v / 60) + 'м' : v + 'с'}
                            </button>
                        ))}
                    </div>
                </div>

                <div className={styles.fullWidth}>
                    <div className={`${styles.card} ${styles.saveCard}`}>
                        <div>
                            <h3>Применить изменения</h3>
                            <p className={styles.desc}>Большинство настроек требуют перезапуска процесса бэкенда.</p>
                        </div>
                        <div className={styles.saveActions}>
                            {msg.text && (
                                <span className={`${styles.msg} ${msg.isError ? styles.err : ''}`}>
                                    {msg.text}
                                </span>
                            )}
                            <button className={styles.saveBtn} onClick={save} disabled={loading}>
                                {loading ? '⏳ Сохраняю...' : '💾 Сохранить'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
