import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { getSettings } from '../../src/storage/settings';
import { applyLocale, applyTheme } from '../../src/theme/apply-theme';

// 渲染前恢复外观设置，避免深色用户先看到一帧浅色页面。
const settings = await getSettings();
applyTheme(settings.theme);
applyLocale(settings.locale);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
