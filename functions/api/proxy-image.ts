export const onRequestGet: PagesFunction = async (context) => {
  try {
    const { request } = context;
    const url = new URL(request.url);
    const imageUrl = url.searchParams.get('url');
    
    if (!imageUrl || typeof imageUrl !== "string") {
      return new Response("Yêu cầu tham số URL hợp lệ.", { status: 400 });
    }
    
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      return new Response(`Failed to fetch original image: ${imgRes.statusText}`, { status: imgRes.status });
    }
    
    const contentType = imgRes.headers.get("content-type") || "image/png";
    const buffer = await imgRes.arrayBuffer();
    
    return new Response(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      }
    });
  } catch (e: any) {
    return new Response("Lỗi máy chủ proxy ảnh.", { status: 500 });
  }
};
