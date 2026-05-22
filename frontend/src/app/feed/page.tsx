'use client';
import { useEffect, useState } from 'react';
import styles from './feed.module.css';

const API_BASE = 'http://localhost:5000/api';

export default function Feed() {
    const [items, setItems] = useState<any[]>([]);

    useEffect(() => {
        fetch(`${API_BASE}/unclustered`).then(r => r.json()).then(setItems);
    }, []);

    return (
        <div className="animate-fade">
            <h1>Лента свежих новостей</h1>
            <div className={styles.list}>
                {items.map(item => (
                    <div key={item.id} className={styles.item}>
                        <p>{item.normalized_text}</p>
                        <div className={styles.meta}>
                            <span className={styles.channel}>@{item.channel_id}</span>
                            <span className={styles.time}>{new Date(item.created_at).toLocaleString()}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
