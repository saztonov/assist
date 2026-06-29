/**
 * Реестр разделов портала. Навигация — через локальное состояние (без react-router,
 * как и весь ai-portal-web). Каждый раздел: ключ, подпись, иконка, элемент.
 */
import type { ReactNode } from 'react';
import {
  ApiOutlined,
  AppstoreOutlined,
  AuditOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  MessageOutlined,
  SettingOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { BuilderPage } from '../pages/builder/BuilderPage';
import { ModelsPage } from '../pages/admin/ModelsPage';
import { TasksPage } from '../pages/tasks/TasksPage';
import { ChatPage } from '../pages/chat/ChatPage';
import { DocumentsPage } from '../pages/documents/DocumentsPage';
import { ApprovalsPage } from '../pages/approvals/ApprovalsPage';
import { ConnectorsPage } from '../pages/connectors/ConnectorsPage';
import { ArtifactsPage } from '../pages/artifacts/ArtifactsPage';

export interface Section {
  key: string;
  label: string;
  icon: ReactNode;
  element: ReactNode;
}

export const SECTIONS: readonly Section[] = [
  { key: 'chat', label: 'Чат', icon: <MessageOutlined />, element: <ChatPage /> },
  { key: 'tasks', label: 'Мои задачи', icon: <UnorderedListOutlined />, element: <TasksPage /> },
  { key: 'templates', label: 'Шаблоны', icon: <AppstoreOutlined />, element: <BuilderPage /> },
  { key: 'documents', label: 'Документы', icon: <FileTextOutlined />, element: <DocumentsPage /> },
  { key: 'connectors', label: 'Подключения', icon: <ApiOutlined />, element: <ConnectorsPage /> },
  { key: 'approvals', label: 'Approvals', icon: <CheckCircleOutlined />, element: <ApprovalsPage /> },
  { key: 'artifacts', label: 'Артефакты', icon: <AuditOutlined />, element: <ArtifactsPage /> },
  { key: 'admin', label: 'Администрирование', icon: <SettingOutlined />, element: <ModelsPage /> },
];

export const DEFAULT_SECTION = SECTIONS[0].key;
