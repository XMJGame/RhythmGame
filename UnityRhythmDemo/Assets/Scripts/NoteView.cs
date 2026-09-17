using UnityEngine;

namespace RhythmCurveDemo
{
    public class NoteView : MonoBehaviour
    {
        public Renderer visualRenderer;

        private Material runtimeMaterial;

        private void Awake()
        {
            if (visualRenderer == null) visualRenderer = GetComponent<Renderer>();
            runtimeMaterial = visualRenderer.material;
        }

        public void Show(Color color, Transform parent, Vector3 position)
        {
            transform.SetParent(parent, false);
            transform.position = position;
            runtimeMaterial.color = color;
            runtimeMaterial.EnableKeyword("_EMISSION");
            runtimeMaterial.SetColor("_EmissionColor", color * .38f);
            gameObject.SetActive(true);
        }

        public void Hide()
        {
            gameObject.SetActive(false);
        }
    }
}
