import { explainScore, type ScoreWeights, type ScoredJourney } from '@kfr/core';
import { Modal } from './ui';
import { fmtScore } from '../lib/format';

export function ScoreBreakdownContent({ journey, weights }: { journey: ScoredJourney; weights: ScoreWeights }) {
  const { rows, final } = explainScore(journey.categoryScores, weights);
  return (
    <div className="stack" data-testid="score-breakdown">
      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th className="right">Score</th>
            <th className="right">Weight</th>
            <th className="right">Contribution</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.category} data-testid={`breakdown-${r.category}`}>
              <td>
                <div>{r.label}</div>
                <div className="breakdown-bar" style={{ marginTop: 4 }}>
                  <div style={{ width: `${r.score}%` }} />
                </div>
              </td>
              <td className="right mono">{fmtScore(r.score)}</td>
              <td className="right mono">× {r.weightPercent.toFixed(0)}%</td>
              <td className="right mono">{r.contribution.toFixed(2)}</td>
            </tr>
          ))}
          <tr className="total">
            <td className="strong">FINAL</td>
            <td />
            <td />
            <td className="right mono strong" data-testid="breakdown-final">
              {fmtScore(final)}
            </td>
          </tr>
        </tbody>
      </table>
      <div>
        <h3 style={{ marginBottom: 6 }}>Why</h3>
        {journey.reasons.map((r, i) => (
          <div key={i} className={`reason ${r.sign === '+' ? 'plus' : r.sign === '-' ? 'minus' : ''}`}>
            <span className="sign">{r.sign}</span>
            <span>{r.text}</span>
          </div>
        ))}
      </div>
      {journey.sleepOpportunityScore > 0 && (
        <p className="small muted">
          Long-haul sleep opportunity: {fmtScore(journey.sleepOpportunityScore)} / 100 (folded into flight timing). Convenience index used for Pareto analysis: {fmtScore(journey.convenienceScore)}.
        </p>
      )}
    </div>
  );
}

export function ScoreBreakdownModal({ journey, weights, onClose }: { journey: ScoredJourney; weights: ScoreWeights; onClose: () => void }) {
  return (
    <Modal title={`Score breakdown · ${fmtScore(journey.overallScore)} / 100`} onClose={onClose} testId="score-breakdown-modal">
      <ScoreBreakdownContent journey={journey} weights={weights} />
    </Modal>
  );
}
