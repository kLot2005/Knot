'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './Sidebar.module.css';

const navItems = [
    { name: 'Обзор', path: '/', icon: '⬡' },
    { name: 'Кластеры', path: '/clusters', icon: '🧩' },
    { name: 'Лента', path: '/feed', icon: '📰' },
    { name: 'Каналы', path: '/channels', icon: '📡' },
    { name: 'Настройки', path: '/settings', icon: '⚙️' },
];

export default function Sidebar() {
    const pathname = usePathname();

    return (
        <nav className={styles.sidebar}>
            <div className={styles.logo}>
                <span className={styles.logoIcon}>⬡</span>
                <span className={styles.logoText}>Knot</span>
            </div>
            <ul className={styles.navLinks}>
                {navItems.map((item) => (
                    <li key={item.path}>
                        <Link
                            href={item.path}
                            className={`${styles.navItem} ${pathname === item.path ? styles.active : ''}`}
                        >
                            <span className={styles.icon}>{item.icon}</span>
                            <span>{item.name}</span>
                        </Link>
                    </li>
                ))}
            </ul>
            <div className={styles.footer}>
                <div className={styles.statusDot}></div>
                <span>Система онлайн</span>
            </div>
        </nav>
    );
}
