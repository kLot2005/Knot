'use client';
import { useEffect, useState } from 'react';
import styles from './page.module.css';

const API_BASE = 'http://localhost:5000/api';

export default function Home() {
  const [stats, setStats] = useState<any>(null);
  const [queue, setQueue] = useState<any>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [sRes, qRes] = await Promise.all([
          fetch(`${API_BASE}/stats`),
          fetch(`${API_BASE}/queue`)
        ]);
        setStats(await sRes.json());
        setQueue(await qRes.json());
      } catch (err) {
        console.error('Failed to fetch stats', err);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  if (!stats) return <div className={styles.loading}>Загрузка данных...</div>;

  return (
    <div className="animate-fade">
      <div className={styles.header}>
        <h1>Обзор системы</h1>
        <button className={styles.btn} onClick={() => window.location.reload()}>⟳ Обновить</button>
      </div>

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Всего новостей</span>
          <span className={styles.statValue}>{stats.totalNews?.toLocaleString()}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Активных кластеров</span>
          <span className={styles.statValue}>{stats.totalClusters?.toLocaleString()}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Не обработано</span>
          <span className={styles.statValue}>{stats.unclustered?.toLocaleString()}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>За последние 24ч</span>
          <span className={styles.statValue}>{stats.last24h?.toLocaleString()}</span>
        </div>
        <button
          className={styles.reprocessBtn}
          onClick={async () => {
            if (!confirm('Запустить генерацию для всех старых кластеров?')) return;
            await fetch(`${API_BASE}/admin/reprocess-clusters`, { method: 'POST' });
            alert('Задача добавлена в очередь!');
          }}
        >
          ⚙️ Пересобрать старые кластеры
        </button>
      </div>

      <div className={styles.row}>
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2>Состояние очередей</h2>
            <button
              className={styles.actionBtn}
              onClick={async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                const oldText = btn.textContent;
                btn.textContent = '⏳ Запуск...';
                try {
                  await fetch(`${API_BASE}/cluster/run`, { method: 'POST' });
                  btn.textContent = '✅ Готово';
                  setTimeout(() => { btn.textContent = oldText; btn.disabled = false; }, 3000);
                } catch {
                  btn.textContent = '❌ Ошибка';
                  btn.disabled = false;
                }
              }}
            >
              ▶ Запустить кластеризацию
            </button>
          </div>
          <div className={styles.queueInfo}>
            <div className={styles.queueItem}>
              <span>Векторизация</span>
              <div className={styles.qVals}>
                <span className={styles.qActive}>{queue?.embedding?.active} active</span>
                <span className={styles.qWait}>{queue?.embedding?.waiting} waiting</span>
              </div>
            </div>
            <div className={styles.queueItem}>
              <span>Кластеризация</span>
              <div className={styles.qVals}>
                <span className={styles.qActive}>{queue?.cluster?.active} active</span>
                <span className={styles.qWait}>{queue?.cluster?.waiting} waiting</span>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.card}>
          <h2>Топ каналов</h2>
          <div className={styles.chart}>
            {stats.byChannel?.map((ch: any) => (
              <div key={ch.channel_id} className={styles.chartBar}>
                <div className={styles.barInfo}>
                  <span>@{ch.channel_id}</span>
                  <span>{ch._count.id}</span>
                </div>
                <div className={styles.barTrack}>
                  <div
                    className={styles.barFill}
                    style={{ width: `${(ch._count.id / stats.byChannel[0]._count.id) * 100}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
