'use client';
import { useEffect, useState } from 'react';
import styles from './clusters.module.css';

const API_BASE = 'http://localhost:5000/api';

export default function Clusters() {
    const [clusters, setClusters] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadClusters();
    }, []);

    const loadClusters = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/clusters`);
            setClusters(await res.json());
        } catch (e) {
            console.error(e);
        }
        setLoading(false);
    };

    const copyAll = (cl: any) => {
        const text = cl.items.map((item: any, i: number) =>
            `[${i + 1}] @${item.channel_id}\n${item.normalized_text}`
        ).join('\n\n---\n\n');
        navigator.clipboard.writeText(text);
        alert('Копирование завершено');
    };

    return (
        <div className="animate-fade">
            <div className={styles.header}>
                <h1>Кластеры новостей</h1>
                <button className={styles.btn} onClick={loadClusters}>⟳ Обновить</button>
            </div>

            {loading ? (
                <div className={styles.loading}>Загрузка кластеров...</div>
            ) : (
                <div className={styles.grid}>
                    {clusters.map(cl => (
                        <div key={cl.id} className={styles.clusterCard}>
                            <div className={styles.clusterHeader}>
                                <span className={styles.badge}>{cl.items.length} постов</span>
                                <span className={styles.time}>{new Date(cl.created_at).toLocaleTimeString()}</span>
                            </div>
                            <div className={styles.itemList}>
                                {cl.items.map((item: any) => (
                                    <div key={item.id} className={styles.item}>
                                        <p>{item.normalized_text.substring(0, 120)}...</p>
                                        <div className={styles.itemFooter}>
                                            <span className={styles.channel}>@{item.channel_id}</span>
                                            <a href={`https://t.me/${item.channel_id}/${item.external_id}`} target="_blank" className={styles.link}>↗</a>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <button className={styles.copyBtn} onClick={() => copyAll(cl)}>📋 Скопировать всё</button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
