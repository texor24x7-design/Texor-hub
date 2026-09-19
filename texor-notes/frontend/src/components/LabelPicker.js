'use client';

/** Which labels a note is filed under. A list of checkboxes, and nothing more. */
export function LabelPicker({ labels, selected = [], onToggle }) {
  const mine = labels.filter((label) => label.isMine);

  if (mine.length === 0) {
    return <p className="meta">No labels yet. Make one in the sidebar and a note can be filed under it.</p>;
  }

  return (
    <div className="stack stack--tight">
      {mine.map((label) => (
        <label className="switch" key={label.id}>
          <input
            type="checkbox"
            checked={selected.includes(label.id)}
            /* An app's label is where its notes live; moving them by hand would
               only mean the app files them back again on its next update. */
            disabled={label.locked}
            onChange={() => onToggle(label.id)}
          />
          <span>
            {label.name}
            {label.locked ? <small>Filed here by {label.name}</small> : null}
          </span>
        </label>
      ))}
    </div>
  );
}

export default LabelPicker;
