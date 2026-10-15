export default function IdentityHeader() {
  return (
    <header className="flex items-center justify-between gap-4 px-1">
      <a href="/" className="flex items-center gap-3 text-[#173c3d] no-underline">
        <span className="grid h-10 w-10 place-items-center rounded-[0.85rem] bg-[#d5e77d] font-display text-lg font-black tracking-[-0.08em]">m.</span>
        <span className="font-display text-sm font-bold tracking-[-0.02em]">MES Learning</span>
      </a>
      <span className="rounded-full border border-[#bdcec7] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#527775] sm:px-4 sm:text-[11px]">Your learning space</span>
    </header>
  )
}
