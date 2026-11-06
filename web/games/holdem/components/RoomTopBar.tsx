interface Props { handNumber:number; sbAmount:number; bbAmount:number; }
export default function RoomTopBar({handNumber,sbAmount,bbAmount}:Props){
 return <div className="flex justify-between px-4 py-2 text-sm text-slate-300 border-b border-slate-800"><span>第 {handNumber} 手</span><span>小盲 {sbAmount} / 大盲 {bbAmount}</span></div>;
}
