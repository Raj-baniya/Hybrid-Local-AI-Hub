import React, { useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { NodeType } from '../schema/graphSchema';
import {
  FolderSearch,
  FileText,
  Image as ImageIcon,
  Sparkles,
  Binary,
  FileSpreadsheet,
  Database,
  GitFork,
  HardDrive,
  Plus,
} from 'lucide-react';

interface PaletteItem {
  type: NodeType['type'];
  label: string;
  category: 'Triggers & Inputs' | 'AI & Processing' | 'Routing & Storage';
  icon: React.ReactNode;
  color: string;
  desc: string;
}

const PALETTE_ITEMS: PaletteItem[] = [
  {
    type: 'FileWatcherNode',
    label: 'File Watcher',
    category: 'Triggers & Inputs',
    icon: <FolderSearch size={16} />,
    color: '#06b6d4',
    desc: 'Watch local folder for file events',
  },
  {
    type: 'TextInputNode',
    label: 'Text Input',
    category: 'Triggers & Inputs',
    icon: <FileText size={16} />,
    color: '#3b82f6',
    desc: 'Static or template text source',
  },
  {
    type: 'ImageInputNode',
    label: 'Image Input',
    category: 'Triggers & Inputs',
    icon: <ImageIcon size={16} />,
    color: '#a855f7',
    desc: 'Load image file from disk',
  },
  {
    type: 'OllamaSelectorNode',
    label: 'Ollama LLM',
    category: 'AI & Processing',
    icon: <Sparkles size={16} />,
    color: '#f59e0b',
    desc: 'Run prompt on local LLM',
  },
  {
    type: 'LocalEmbedderNode',
    label: 'Embedder',
    category: 'AI & Processing',
    icon: <Binary size={16} />,
    color: '#10b981',
    desc: 'Generate vector embeddings',
  },
  {
    type: 'PDFExtractorNode',
    label: 'PDF Extractor',
    category: 'AI & Processing',
    icon: <FileSpreadsheet size={16} />,
    color: '#ef4444',
    desc: 'Extract plain text from PDF',
  },
  {
    type: 'ConditionalRouterNode',
    label: 'Router',
    category: 'Routing & Storage',
    icon: <GitFork size={16} />,
    color: '#ec4899',
    desc: 'Branch execution based on content',
  },
  {
    type: 'ChromaDbStoreNode',
    label: 'ChromaDB Store',
    category: 'Routing & Storage',
    icon: <Database size={16} />,
    color: '#6366f1',
    desc: 'Store vectors in local ChromaDB',
  },
  {
    type: 'LocalFileWriterNode',
    label: 'File Writer',
    category: 'Routing & Storage',
    icon: <HardDrive size={16} />,
    color: '#14b8a6',
    desc: 'Write output to local file',
  },
];

export const NodePalette: React.FC = () => {
  const addNode = useWorkflowStore((s) => s.addNode);
  const [search, setSearch] = useState('');

  const filtered = PALETTE_ITEMS.filter((item) =>
    item.label.toLowerCase().includes(search.toLowerCase()) ||
    item.desc.toLowerCase().includes(search.toLowerCase())
  );

  const categories = Array.from(new Set(PALETTE_ITEMS.map((i) => i.category)));

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      style={{
        width: 260,
        background: 'rgba(15, 23, 42, 0.9)',
        borderRight: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: '#94a3b8', textTransform: 'uppercase' }}>
          Node Palette
        </div>
        <input
          type="text"
          placeholder="Filter nodes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%',
            marginTop: 10,
            padding: '6px 10px',
            background: 'rgba(0, 0, 0, 0.3)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 6,
            color: '#f8fafc',
            fontSize: 12,
            outline: 'none',
          }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {categories.map((cat) => {
          const items = filtered.filter((i) => i.category === cat);
          if (items.length === 0) return null;
          return (
            <div key={cat}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 8 }}>{cat}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {items.map((item) => (
                  <div
                    key={item.type}
                    draggable
                    onDragStart={(e) => onDragStart(e, item.type)}
                    onClick={() => addNode(item.type)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                      borderRadius: 8,
                      cursor: 'grab',
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)';
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.06)';
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ color: item.color }}>{item.icon}</div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: '#f1f5f9' }}>{item.label}</div>
                        <div style={{ fontSize: 10, color: '#64748b' }}>{item.desc}</div>
                      </div>
                    </div>
                    <Plus size={14} style={{ color: '#64748b' }} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
