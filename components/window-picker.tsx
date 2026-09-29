/** Date window as a plain GET form so the URL is shareable (?from&to). */
export function WindowPicker({ from, to, extra }: { from: string; to: string; extra?: React.ReactNode }) {
  return (
    <form className="flex flex-wrap items-end gap-3" method="get">
      {extra}
      <label className="text-sm">From<input type="date" name="from" defaultValue={from} className="ml-2 h-9 rounded-md border border-line bg-panel px-2" /></label>
      <label className="text-sm">To<input type="date" name="to" defaultValue={to} className="ml-2 h-9 rounded-md border border-line bg-panel px-2" /></label>
      <button className="h-9 rounded-md border border-line bg-panel px-3 text-sm font-medium hover:border-steel">Apply</button>
    </form>
  );
}
