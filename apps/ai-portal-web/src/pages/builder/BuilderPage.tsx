/**
 * Конструктор шаблонов: переключение list ↔ editor через локальное состояние
 * (без react-router, как и остальной ai-portal-web). Frontend сам workflow НЕ
 * исполняет — только сохраняет/публикует WorkflowTemplate JSON и запускает test-run
 * через backend.
 */
import { useState } from 'react';
import { TemplateListView } from './TemplateListView';
import { WorkflowEditor } from './WorkflowEditor';

type View = { kind: 'list' } | { kind: 'editor'; templateId: string | null };

export function BuilderPage(): JSX.Element {
  const [view, setView] = useState<View>({ kind: 'list' });

  if (view.kind === 'editor') {
    return (
      <WorkflowEditor
        templateId={view.templateId}
        onBack={() => setView({ kind: 'list' })}
        onSaved={(id) => setView({ kind: 'editor', templateId: id })}
      />
    );
  }
  return <TemplateListView onOpen={(templateId) => setView({ kind: 'editor', templateId })} />;
}
