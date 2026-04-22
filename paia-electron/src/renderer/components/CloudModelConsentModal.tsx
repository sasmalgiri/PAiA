// Consent gate for selecting a cloud model while `allowCloudModels` is off.
//
// The master cloud gate in providers.chat() would already reject the call
// at chat-send time — but by then the user's prompt has been composed and
// the error is confusing ("why did my send fail?"). This modal intercepts
// at model-selection time and makes the tradeoff explicit: pick a cloud
// model → get a consent dialog → accept flips allowCloudModels on as part
// of the same action.
//
// Matches the shape of McpApprovalModal so the existing `.modal-backdrop`
// / `.modal` CSS applies without additions.

import { useRef } from 'react';
import type { ProviderId } from '../../shared/types';
import { useFocusTrap } from '../lib/focusTrap';

interface Props {
  providerId: ProviderId;
  providerName: string;
  modelName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CloudModelConsentModal({ providerId, providerName, modelName, onConfirm, onCancel }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(containerRef, { onClose: onCancel });

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal"
        ref={containerRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cloud-consent-title"
        aria-describedby="cloud-consent-desc"
      >
        <div className="modal-title" id="cloud-consent-title">
          <span>Send prompts to {providerName}?</span>
        </div>
        <div className="modal-body" id="cloud-consent-desc">
          <p>
            You picked <code>{providerId}:{modelName}</code> — a cloud model. Using it means every
            prompt PAiA sends (including any screen OCR, pasted files, or attached context) is
            transmitted to <strong>{providerName}</strong> and handled under their terms, not yours.
          </p>
          <p className="muted-note">
            PAiA's default posture is "nothing leaves localhost." Confirming here switches off that
            default and turns on cloud model access in Settings. You can switch it back off any time.
          </p>
          <p className="muted-note">
            If you want the speed of a cloud model without {providerName}'s retention policy,
            consider the <strong>OpenAI-compatible</strong> provider pointing at Groq or Together,
            or keep using a local Ollama model.
          </p>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>Keep local model</button>
          <button type="button" className="primary" onClick={onConfirm}>
            Enable cloud & select this model
          </button>
        </div>
      </div>
    </div>
  );
}
