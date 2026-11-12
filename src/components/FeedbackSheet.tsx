import Sheet from './ui/Sheet';
import {
  FEEDBACK_NOTE,
  MESSAGE_MAX,
  NAME_MAX,
  NOT_SENT,
  SENT,
  type FeedbackDraft,
  type FeedbackStatus,
} from '../lib/sendFeedback';

interface Props {
  draft: FeedbackDraft;
  /** Owned by App with the draft, so a send outlives the sheet and a reopened sheet shows it. */
  status: FeedbackStatus;
  onDraft: (draft: FeedbackDraft) => void;
  onSend: () => void;
  onClose: () => void;
}

/**
 * (#255) Send feedback: one required box, an optional name, a dark Send pill. While a note is on
 * its way both fields are read-only and Send is off, so nothing typed is lost and nothing posts twice.
 * (#342) With a phone keyboard open the sheet sits on top of it and Send stays in view (index.css).
 */
export default function FeedbackSheet({ draft, status, onDraft, onSend, onClose }: Props) {
  const sending = status === 'sending';
  const canSend = draft.message.trim().length > 0 && !sending;

  return (
    <Sheet title="Send feedback" onClose={onClose} variant="feedback">
      <form
        className="feedback-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSend) onSend();
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
          readOnly={sending}
          maxLength={MESSAGE_MAX}
          value={draft.message}
          aria-describedby="feedback-note"
          onChange={(event) => onDraft({ ...draft, message: event.target.value })}
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
          readOnly={sending}
          maxLength={NAME_MAX}
          autoComplete="given-name"
          value={draft.name}
          onChange={(event) => onDraft({ ...draft, name: event.target.value })}
        />
        <p className="feedback-form__status" role="status">
          {sending && 'Sending…'}
          {status === 'sent' && SENT}
        </p>
        {status === 'failed' && (
          <p className="error-text" role="alert">
            {NOT_SENT}
          </p>
        )}
        <div className="sheet-actions">
          <button type="submit" className="primary" disabled={!canSend}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
