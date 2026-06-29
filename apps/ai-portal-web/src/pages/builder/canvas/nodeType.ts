import type { Node } from '@xyflow/react';
import type { RfNodeData } from '../mapping';

/** Единственный тип узла React Flow в конструкторе — data-driven по catalogKey. */
export type BlockNodeType = Node<RfNodeData, 'block'>;
