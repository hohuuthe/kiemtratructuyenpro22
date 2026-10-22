// Cổng API thô cũ đã được đóng hoàn toàn
export const onRequest: PagesFunction = async () => {
  return new Response(JSON.stringify({
    error: "Cổng API cũ đã được đóng hoàn toàn theo kiến trúc mới. Hệ thống vận hành 100% trên Neon PostgreSQL."
  }), {
    status: 410,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*"
    }
  });
};
