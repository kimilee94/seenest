import React from 'react';
import ReactDOM from 'react-dom/client';
import { Popup } from './Popup';
import './styles.css';
import { getSettings } from '../../src/storage/settings';
import { applyLocale, applyTheme } from '../../src/theme/apply-theme';
import { installExtensionContextInvalidationGuard } from '../../src/utils/extension-context';

// 插件弹窗空间较小，先应用已保存的主题再渲染，避免打开时闪烁。
installExtensionContextInvalidationGuard();
const settings = await getSettings();
applyTheme(settings.theme);
applyLocale(settings.locale);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><Popup /></React.StrictMode>,
);
