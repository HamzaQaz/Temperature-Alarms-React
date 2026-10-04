/** The dashed panel that stands in for a page's content when there is nothing to show: empty, or an error. */
export function Placeholder({ children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center" {...props}>
      {children}
    </div>
  );
}
