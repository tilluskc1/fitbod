import { useState } from 'react';
import Sheet from './ui/Sheet';
import {
  FEEDBACK_NOTE,
  MESSAGE_MAX,
  NAME_MAX,
  NOT_SENT,
  SENT,
  type FeedbackDraft,
  type SendResult,
} from '../lib/sendFeedback';

interface Props {
  draft: FeedbackDraft;
  onDraft: (draft: FeedbackDraft) => void;
  /** Posts the note; App adds the version, screen, device, workout count and tester ID. */
  onSend: (draft: FeedbackDraft) => Promise<SendResult>;
  onClose: () => void;
}

/**
 * (#255) Send feedback: one required box, an optional name, a dark Send pill. A failed or offline
 * send keeps the text and says so; a sent note clears the box and says thanks.
 */
export default function FeedbackSheet({ draft, onDraft, onSend, onClose }: Props) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const canSend = draft.message.trim().length > 0 && status !== 'sending';

  const send = async () => {
    if (!canSend) return;
    setStatus('sending');
    const sent = draft;
    const result = await onSend(sent);
    if (result.ok) {
      onDraft({ ...sent, message: '' });
      setStatus('sent');
    } else {
      setStatus('failed');
    }
  };

  const edit = (patch: Partial<FeedbackDraft>) => {
    onDraft({ ...draft, ...patch });
    if (status === 'sent' || status === 'failed') setStatus('idle');
  };

  return (
    <Sheet title="Send feedback" onClose={onClose}>
      <form
        className="feedback-form"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="field-label" htmlFor="feedback-message">
          What should we know?
        </label>
        <textarea
          id="feedback-message"
          className="feedback-form__message"
          rows={5}
          required
          maxLength={MESSAGE_MAX}
          value={draft.message}
          aria-describedby="feedback-note"
          onChange={(event) => edit({ message: event.target.value })}
        />
        <p className="feedback-form__note" id="feedback-note">
          {FEEDBACK_NOTE}
        </p>
        <label className="field-label" htmlFor="feedback-name">
          Your name (optional)
        </label>
        <input
          id="feedback-name"
          className="search feedback-form__name"
          type="text"
          maxLength={NAME_MAX}
          autoComplete="given-name"
          value={draft.name}
          onChange={(event) => edit({ name: event.target.value })}
        />
        <p className="feedback-form__status" role="status">
          {status === 'sent' && SENT}
        </p>
        {status === 'failed' && (
          <p className="error-text" role="alert">
            {NOT_SENT}
          </p>
        )}
        <div className="sheet-actions">
          <button type="submit" className="primary" disabled={!canSend}>
            {status === 'sending' ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
