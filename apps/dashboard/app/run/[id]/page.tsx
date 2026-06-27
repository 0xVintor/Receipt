import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRun } from '../../lib/data';

export const dynamic = 'force-dynamic';

const ICON = { verified: '✓', failed: '✗', unverifiable: '?' } as const;

export default function RunPage({ params }: { params: { id: string } }) {
  const data = getRun(params.id);
  if (!data) notFound();
  const { run, claims } = data;

  return (
    <main className="container">
      <Link href="/" className="back">
        ← all runs
      </Link>

      <div className="header">
        <span className={`badge ${run.overall}`}>{run.overall}</span>
        <span className="brand" style={{ fontSize: 18 }}>
          {run.taskText || '(no task captured)'}
        </span>
      </div>
      <p className="sub">
        <span className="mono">{run.agent}</span> · {run.projectPath} ·{' '}
        {new Date(run.createdAt).toLocaleString()}
      </p>

      <div className="verdict">
        Claimed <strong>{claims.length}</strong> — verified {run.counts.verified}, failed{' '}
        {run.counts.failed}, unverifiable {run.counts.unverifiable}
      </div>

      {claims.map((c) => (
        <div key={c.id} className="claim">
          <span className={`icon ${c.status}`}>{ICON[c.status]}</span>
          <div className="body">
            <div>
              {c.rawText}
              <span className="tag">{c.type}</span>
              <span className="tag">{c.source}</span>
            </div>
            <div className="evidence">{c.evidence}</div>
          </div>
        </div>
      ))}
    </main>
  );
}
