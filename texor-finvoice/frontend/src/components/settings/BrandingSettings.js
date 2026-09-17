'use client';

import { useToast } from '@/components/ui';
import { ImageInput } from '@/components/fields/FieldInput';
import { SignatureField } from './SignatureUpload';
import { ACCOUNTS_ORIGIN } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import { SettingsLayout } from './SettingsLayout';

const ACCENTS = ['#12a57f', '#0f9f7a', '#2563eb', '#6741d9', '#c2255c', '#d9480f', '#e67700', '#1098ad', '#0d1b17', '#475569'];

export function BrandingSettings() {
  const { api, workspace, apply, user } = useWorkspace();
  const toast = useToast();
  async function save(branding, message = 'Saved') {
    try { apply(await api.patch('/settings/business', { branding })); toast(message); } catch (error) { toast(error.message, 'error'); }
  }

  return (
    <SettingsLayout section="branding" title="Logo & signature" description="Your logo, photo and signature appear on documents, public links and warranty cards.">
      <div className="grid-2">
        <section className="card">
          <div className="card-header"><h2>Logo</h2></div>
          <div className="card-body"><ImageInput value={workspace.branding?.logo} onChange={(logo) => save({ logo }, 'Logo updated')} purpose="logo" label="Upload your logo" /></div>
        </section>
        <section className="card">
          <div className="card-header"><h2>Business photo</h2></div>
          <div className="card-body"><ImageInput value={workspace.branding?.photo} onChange={(photo) => save({ photo }, 'Photo updated')} purpose="photo" label="Shopfront or team photo" /></div>
        </section>
      </div>

      <section className="card">
        <div className="card-header"><div><h2>Signature</h2><p className="small muted">Printed above “Authorised signatory” on quotations and invoices.</p></div></div>
        <div className="card-body">
          <SignatureField value={workspace.branding?.signature} onChange={(signature) => save({ signature }, signature ? 'Signature saved' : 'Signature removed')} />
        </div>
      </section>

      <section className="card">
        <div className="card-header"><div><h2>Accent colour</h2><p className="small muted">Used by the Modern design and across your dashboard.</p></div></div>
        <div className="card-body row wrap">
          {ACCENTS.map((color) => (
            <button key={color} type="button" onClick={() => save({ accent: color }, 'Accent updated')} aria-label={`Use ${color}`} aria-pressed={workspace.branding?.accent === color}
              style={{ width: 36, height: 36, borderRadius: 10, background: color, border: workspace.branding?.accent === color ? '3px solid #fff' : '0', boxShadow: workspace.branding?.accent === color ? `0 0 0 2px ${color}` : 'var(--shadow-sm)', cursor: 'pointer' }} />
          ))}
          <input type="color" value={workspace.branding?.accent ?? '#12a57f'} onChange={(e) => save({ accent: e.target.value }, 'Accent updated')} aria-label="Custom colour" style={{ width: 44, height: 36, border: 0, background: 'none' }} />
        </div>
      </section>

      <section className="card card-pad row">
        <img src={user?.picture || '/brand/finvoice-icon.svg'} alt="" style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }} />
        <div className="grow"><div className="strong">Your profile photo</div><div className="small muted">It comes from your Texor Account, so it is the same in every Texor product.</div></div>
        {ACCOUNTS_ORIGIN ? <a className="btn btn-secondary" href={ACCOUNTS_ORIGIN} target="_blank" rel="noreferrer">Change in Texor Account</a> : null}
      </section>
    </SettingsLayout>
  );
}
