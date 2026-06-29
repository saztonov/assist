import { Empty, Typography } from 'antd';

/** Артефакты: backend-эндпоинт ещё не реализован (501) — раздел-заглушка. */
export function ArtifactsPage(): JSX.Element {
  return (
    <>
      <Typography.Title level={4}>Артефакты</Typography.Title>
      <Empty description="Раздел в разработке" />
    </>
  );
}
