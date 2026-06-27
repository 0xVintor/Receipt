import Link from 'next/link';
import { getRuns } from './lib/data';

export const dynamic = 'force-dynamic';

function relTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Home() {
  const runs = getRuns(100);

  return (
    <main className="container">
      <div className="header">
        <span className="brand">Receipt</span>
        <span className="badge pass" style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)' }}>
          local
        </span>
      </div>
      <p className="sub">
        Run history from <span className="mono">~/.receipt/receipt.db</span> · {runs.length} run
        {runs.length === 1 ? '' : 's'}
      </p>

      {runs.length === 0 ? (
        <div className="empty">
          No receipts yet. Run <span className="mono">receipt check</span> after an agent finishes a
          task, then refresh.
        </div>
      ) : (
        runs.map((r) => (
          <Link key={r.id} href={`/run/${r.id}`} className="card">
            <div className="row">
              <span className={`badge ${r.overall}`}>{r.overall}</span>
              <div className="spacer" />
              <span className="meta">{relTime(r.createdAt)}</span>
            </div>
            <div className="task" style={{ marginTop: 10 }}>
              {r.taskText || '(no task captured)'}
            </div>
            <div className="row">
              <span className="meta mono">{r.agent}</span>
              <div className="spacer" />
              <div className="counts">
                <span className="count">
                  <span className="dot v" /> {r.counts.verified}
                </span>
                <span className="count">
                  <span className="dot f" /> {r.counts.failed}
                </span>
                <span className="count">
                  <span className="dot u" /> {r.counts.unverifiable}
                </span>
              </div>
            </div>
          </Link>
        ))
      )}
    </main>
  );
}
