'use client';
import { useEffect, useState } from 'react';
import styles from './channels.module.css';

const API_BASE = 'http://localhost:5000/api';

export default function Channels() {
    const [channels, setChannels] = useState<any[]>([]);
    const [newUsername, setNewUsername] = useState('');

    useEffect(() => {
        loadChannels();
    }, []);

    const loadChannels = async () => {
        const res = await fetch(`${API_BASE}/channels`);
        setChannels(await res.json());
    };

    const addChannel = async () => {
        if (!newUsername) return;
        await fetch(`${API_BASE}/channels`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: newUsername })
        });
        setNewUsername('');
        loadChannels();
    };

    const toggle = async (id: number, current: boolean) => {
        await fetch(`${API_BASE}/channels/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: !current })
        });
        loadChannels();
    };

    const remove = async (id: number) => {
        if (!confirm('Удалить?')) return;
        await fetch(`${API_BASE}/channels/${id}`, { method: 'DELETE' });
        loadChannels();
    };

    return (
        <div className="animate-fade">
            <h1>Управление каналами</h1>

            <div className={styles.card} style={{ marginTop: '24px' }}>
                <h2>Добавить новый канал</h2>
                <div className={styles.inputRow}>
                    <input
                        className={styles.input}
                        value={newUsername}
                        onChange={e => setNewUsername(e.target.value)}
                        placeholder="kaztag_tg"
                    />
                    <button className={styles.addBtn} onClick={addChannel}>Добавить</button>
                </div>
            </div>

            <div className={styles.card} style={{ marginTop: '24px' }}>
                <h2>Отслеживаемые каналы</h2>
                <div className={styles.table}>
                    {channels.map(ch => (
                        <div key={ch.id} className={styles.row}>
                            <div className={styles.chInfo}>
                                <span className={styles.username}>@{ch.username}</span>
                                <span className={`${styles.status} ${ch.is_active ? styles.active : ''}`}>
                                    {ch.is_active ? 'Активен' : 'Пауза'}
                                </span>
                            </div>
                            <div className={styles.actions}>
                                <button className={styles.actionBtn} onClick={() => toggle(ch.id, ch.is_active)}>
                                    {ch.is_active ? '⏸' : '▶'}
                                </button>
                                <button className={styles.deleteBtn} onClick={() => remove(ch.id)}>🗑</button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
